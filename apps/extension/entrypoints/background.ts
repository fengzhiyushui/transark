import { defineBackground } from 'wxt/utils/define-background';
import { loadSettings, saveSettings, getActiveProfile } from '../src/storage/extension-storage';
import { createTranslationProvider } from '../src/adapters/provider-factory';
import { fetchAvailableModels } from '../src/adapters/model-fetcher';
import type {
  ExtensionMessage,
  MessageResponse,
  TranslateSegmentsPayload,
} from '../src/messaging/protocol';
import type {
  TranslationResponse,
  TranslationRequest,
  TranslationProviderConfig,
} from '@translate/contracts';

export default defineBackground(() => {
  console.log('[Background] TransArk (译舟) Service Worker initialized');

  // 初始化默认配置
  chrome.runtime.onInstalled.addListener(async () => {
    console.log('[Background] Extension installed/updated, ensuring settings...');
    await loadSettings();
  });

  // 统一消息总线处理
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender)
      .then((res) => sendResponse(res))
      .catch((err) => {
        console.error('[Background] Message handling error:', err);
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // 返回 true 以指示异步响应
    return true;
  });
});

/** 把单个段落增量推送给发起翻译的标签页 */
function pushSegmentToTab(
  tabId: number | undefined,
  requestId: string,
  segment: { id: string; translation: string; error?: { code: string; message: string } }
): void {
  if (tabId === undefined) return;
  try {
    chrome.tabs
      .sendMessage(tabId, {
        type: 'TRANSLATE_SEGMENT_STREAM',
        payload: { requestId, segment },
      })
      .catch(() => {
        // 标签页可能已关闭或未注入 content script：忽略即可
      });
  } catch {
    // 上下文失效时静默忽略，不影响最终结果返回
  }
}

async function handleMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender
): Promise<MessageResponse<any>> {
  switch (message.type) {
    case 'PING':
      return { success: true, data: 'PONG' };

    case 'GET_SETTINGS': {
      const settings = await loadSettings();
      return { success: true, data: settings };
    }

    case 'UPDATE_SETTINGS': {
      const updated = await saveSettings(message.payload || {});
      return { success: true, data: updated };
    }

    case 'TEST_PROVIDER_CONNECTION': {
      const payload = message.payload as { profile: TranslationProviderConfig } | undefined;
      if (!payload?.profile) {
        return { success: false, error: 'Missing profile parameter for connection test' };
      }
      const { profile } = payload;
      const provider = createTranslationProvider(profile);
      const testResult = await provider.testConnection();
      return { success: true, data: testResult };
    }

    case 'FETCH_MODELS': {
      const payload = message.payload as { baseUrl: string; apiKey?: string; protocol?: string } | undefined;
      if (!payload?.baseUrl) {
        return { success: false, error: '缺少 BaseUrl 参数' };
      }
      try {
        const models = await fetchAvailableModels(payload.baseUrl, payload.apiKey, payload.protocol);
        return { success: true, data: { models } };
      } catch (err: any) {
        return { success: false, error: err?.message || '获取模型列表失败' };
      }
    }

    case 'TRANSLATE_SEGMENTS': {
      const payload = message.payload as TranslateSegmentsPayload | undefined;
      if (!payload) {
        return { success: false, error: 'Missing request payload for TRANSLATE_SEGMENTS' };
      }
      const settings = await loadSettings();
      let profile = await getActiveProfile();

      // 若请求指明了特定的 Profile ID 则寻找对应 Profile
      if (payload.profileId) {
        const found = settings.profiles.find((p) => p.profileId === payload.profileId);
        if (found) profile = found;
      }

      const provider = createTranslationProvider(profile);
      const request = payload as TranslationRequest;

      // 流式：把增量推回发起方所在标签页
      const targetTabId = payload.tabId ?? sender?.tab?.id;
      const onSegment =
        payload.stream === true
          ? (segment: { id: string; translation: string; error?: { code: string; message: string } }) =>
              pushSegmentToTab(targetTabId, payload.requestId, segment)
          : undefined;

      const response: TranslationResponse = await provider.translate(request, undefined, onSegment);

      return {
        success: true,
        data: response,
      };
    }

    default:
      return {
        success: false,
        error: `Unknown message type: ${(message as any)?.type}`,
      };
  }
}
