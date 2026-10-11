import { defineBackground } from 'wxt/utils/define-background';
import { loadSettings, saveSettings, getActiveProfile } from '../src/storage/extension-storage';
import { createTranslationProvider } from '../src/adapters/provider-factory';
import { fetchAvailableModels } from '../src/adapters/model-fetcher';
import type {
  ExtensionMessage,
  MessageResponse,
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
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    handleMessage(message)
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

async function handleMessage(message: ExtensionMessage): Promise<MessageResponse<any>> {
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
      const settings = await loadSettings();
      const provider = createTranslationProvider(profile, settings.mockDelayMs);
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
      const request = message.payload as TranslationRequest | undefined;
      if (!request) {
        return { success: false, error: 'Missing request payload for TRANSLATE_SEGMENTS' };
      }
      const settings = await loadSettings();
      let profile = await getActiveProfile();

      // 若请求指明了特定的 Profile ID 则寻找对应 Profile
      if (request.profileId) {
        const found = settings.profiles.find((p) => p.profileId === request.profileId);
        if (found) profile = found;
      }

      const provider = createTranslationProvider(profile, settings.mockDelayMs);
      const response: TranslationResponse = await provider.translate(request);

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
