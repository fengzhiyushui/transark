import { defineBackground } from 'wxt/utils/define-background';
import { loadSettings, saveSettings, getActiveProfile } from '../src/storage/extension-storage';
import { createTranslationProvider } from '../src/adapters/provider-factory';
import { fetchAvailableModels } from '../src/adapters/model-fetcher';
import { isCloudConfigured, translateCuesCloud } from '../src/cloud/client';
import type {
  ExtensionMessage,
  MessageResponse,
  TranslateSegmentsPayload,
  CloudTranslateCuesMessage,
  AsrEventPayload,
} from '../src/messaging/protocol';
import type {
  TranslationResponse,
  TranslationRequest,
  TranslationProviderConfig,
} from '@translate/contracts';

interface OffscreenStartPayload {
  streamId: string;
  endpoint: string;
  apiKey: string;
  targetLanguage: string;
  sourceLanguage?: string;
  sessionId: string;
  tabId: number;
}

let creatingOffscreen: Promise<void> | null = null;

export default defineBackground(() => {
  console.log('[Background] TransArk (译舟) Service Worker initialized');

  chrome.runtime.onInstalled.addListener(async () => {
    await loadSettings();
  });

  // 统一消息总线处理
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    // 发给 offscreen 的内部控制消息不应由 Background 应答（避免与 offscreen 抢答）
    if (String((message as any)?.type || '').startsWith('OFFSCREEN_')) {
      return false;
    }
    // Offscreen 的 ASR 事件：转发到发起字幕的标签页
    if ((message as any)?.type === 'ASR_EVENT') {
      const payload = (message as any).payload as { tabId: number; event: AsrEventPayload };
      if (payload?.tabId !== undefined) {
        chrome.tabs
          .sendMessage(payload.tabId, { type: 'ASR_EVENT', payload: payload.event })
          .catch(() => {});
      }
      sendResponse({ success: true });
      return false;
    }

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
    // 上下文失效时静默忽略
  }
}

/** 保证 offscreen 文档存在（音频采集与 WebSocket 都在其中执行）。 */
async function ensureOffscreenDocument(): Promise<void> {
  const offscreen = (chrome as any).offscreen;
  if (!offscreen?.createDocument) {
    throw new Error('当前浏览器不支持 offscreen API（需 Chrome 116+）');
  }
  if (await offscreen.hasDocument?.()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: '捕获当前标签页音频以进行实时字幕识别',
      })
      .catch((err: Error) => {
        // 并发创建时可能抛出「已存在」，视为成功
        if (!/single offscreen|already/i.test(err.message)) throw err;
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
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
      const payload = message.payload as
        | { baseUrl: string; apiKey?: string; protocol?: string }
        | undefined;
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
          ? (segment: {
              id: string;
              translation: string;
              error?: { code: string; message: string };
            }) => pushSegmentToTab(targetTabId, payload.requestId, segment)
          : undefined;

      const response: TranslationResponse = await provider.translate(request, undefined, onSegment);

      return {
        success: true,
        data: response,
      };
    }

    // ------------------------------------------------------ 云端字幕翻译
    case 'CLOUD_TRANSLATE_CUES': {
      const settings = await loadSettings();
      if (!isCloudConfigured(settings.cloud)) {
        return {
          success: false,
          error: '云端服务未启用：请在设置中填写服务地址与 API Key',
          errorCode: 'CLOUD_NOT_CONFIGURED',
        };
      }
      const payload = message.payload as CloudTranslateCuesMessage['payload'];
      if (!payload?.segments?.length) {
        return { success: false, error: '没有待翻译的字幕段落' };
      }
      const tabId = sender?.tab?.id;
      try {
        const response = await translateCuesCloud(
          settings.cloud,
          {
            requestId: payload.requestId,
            sourceLanguage: payload.sourceLanguage || 'auto',
            targetLanguage: payload.targetLanguage,
            segments: payload.segments,
          },
          (segment) => {
            if (tabId === undefined) return;
            chrome.tabs
              .sendMessage(tabId, {
                type: 'SUBTITLE_CUE_TRANSLATED',
                payload: { requestId: payload.requestId, segment },
              })
              .catch(() => {});
          }
        );
        return { success: true, data: response };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || '字幕翻译失败',
          errorCode: err?.code,
        };
      }
    }

    // ------------------------------------------------------------ 流式 ASR
    case 'ASR_START': {
      const settings = await loadSettings();
      if (!isCloudConfigured(settings.cloud)) {
        return {
          success: false,
          error: '云端服务未启用，无法在无字幕时生成字幕',
          errorCode: 'CLOUD_NOT_CONFIGURED',
        };
      }
      if (settings.cloud.asrFallback === false) {
        return {
          success: false,
          error: '已在设置中关闭「无字幕视频自动启用实时 ASR」',
          errorCode: 'ASR_DISABLED',
        };
      }
      const tabId = sender?.tab?.id;
      if (tabId === undefined) {
        return { success: false, error: '无法定位当前标签页' };
      }
      const tabCapture = (chrome as any).tabCapture;
      if (!tabCapture?.getMediaStreamId) {
        return { success: false, error: '当前浏览器不支持标签页音频捕获' };
      }
      try {
        const streamId: string = await tabCapture.getMediaStreamId({ targetTabId: tabId });
        await ensureOffscreenDocument();
        const payload: OffscreenStartPayload = {
          streamId,
          endpoint: settings.cloud.endpoint,
          apiKey: settings.cloud.apiKey,
          targetLanguage:
            (message.payload as { targetLanguage?: string } | undefined)?.targetLanguage ||
            settings.targetLanguage,
          sourceLanguage: settings.sourceLanguage,
          sessionId: `tab-${tabId}-${Date.now()}`,
          tabId,
        };
        await chrome.runtime.sendMessage({ type: 'OFFSCREEN_ASR_START', payload });
        return { success: true, data: { sessionId: payload.sessionId } };
      } catch (err: any) {
        return { success: false, error: err?.message || '启动音频捕获失败' };
      }
    }

    case 'ASR_STOP': {
      try {
        await chrome.runtime.sendMessage({ type: 'OFFSCREEN_ASR_STOP' });
        return { success: true };
      } catch {
        return { success: true };
      }
    }

    // ------------------------------------------------ 站点字幕受控抓取
    case 'FETCH_SUBTITLE_TRACK': {
      const payload = message.payload as { url: string } | undefined;
      if (!payload?.url) {
        return { success: false, error: '缺少字幕 URL' };
      }
      let parsed: URL;
      try {
        parsed = new URL(payload.url);
      } catch {
        return { success: false, error: '字幕 URL 格式非法' };
      }
      const host = parsed.hostname.toLowerCase();
      const allowedHost = host === 'youtube.com' || host.endsWith('.youtube.com');
      if (
        parsed.protocol !== 'https:' ||
        !allowedHost ||
        !parsed.pathname.includes('/api/timedtext')
      ) {
        return { success: false, error: '不允许抓取该字幕地址（仅限受控站点）' };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(payload.url, { signal: controller.signal });
        if (!response.ok) {
          return { success: false, error: `字幕抓取失败: HTTP ${response.status}` };
        }
        const body = await response.text();
        if (body.length > 5 * 1024 * 1024) {
          return { success: false, error: '字幕内容超过 5MB 上限' };
        }
        return { success: true, data: { body } };
      } catch (err: any) {
        return { success: false, error: err?.message || '字幕抓取失败' };
      } finally {
        clearTimeout(timer);
      }
    }

    default:
      return {
        success: false,
        error: `Unknown message type: ${(message as any)?.type}`,
      };
  }
}
