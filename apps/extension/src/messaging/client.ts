import type {
  ExtensionMessage,
  MessageResponse,
  PageTranslationStatus,
} from './protocol';
import type {
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
  TranslationSegmentResult,
} from '@translate/contracts';
import type { ExtensionSettings } from '../storage/extension-storage';

export async function sendMessageToBackground<T = unknown>(
  message: ExtensionMessage
): Promise<MessageResponse<T>> {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      const response = await chrome.runtime.sendMessage(message);
      return response || { success: false, error: 'No response from background worker' };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to send message to background',
    };
  }
  return { success: false, error: 'Extension runtime not available' };
}

export async function sendMessageToTab<T = unknown>(
  tabId: number,
  message: ExtensionMessage
): Promise<MessageResponse<T>> {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response || { success: false, error: 'No response from tab' };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to send message to content script',
    };
  }
  return { success: false, error: 'Tabs runtime not available' };
}

export async function getActiveTabId(): Promise<number | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id ?? null;
    }
  } catch (err) {
    console.warn('[Messaging] Failed to query active tab', err);
  }
  return null;
}

/**
 * 请求翻译。
 *
 * @param request  翻译请求
 * @param onSegment 可选的逐段增量回调。传入时启用流式：
 *                  Background 每解析出一个完整段落就推送过来，
 *                  实现「首段即回填」，无需等待整批完成。
 *                  返回的 TranslationResponse 仍是完整权威结果。
 */
export async function requestTranslation(
  request: TranslationRequest,
  onSegment?: (segment: TranslationSegmentResult) => void
): Promise<TranslationResponse> {
  const stream = Boolean(onSegment);

  // 流式：预先注册增量监听，按 requestId 过滤属于本次请求的段落
  if (stream && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    const requestId = request.requestId;
    const listener = (message: any) => {
      if (message?.type !== 'TRANSLATE_SEGMENT_STREAM') return;
      if (message.payload?.requestId !== requestId) return;
      const seg = message.payload.segment;
      if (seg) onSegment?.(seg as TranslationSegmentResult);
    };
    chrome.runtime.onMessage.addListener(listener);

    try {
      const resp = await sendMessageToBackground<TranslationResponse>({
        type: 'TRANSLATE_SEGMENTS',
        payload: { ...request, stream: true },
      });
      if (!resp.success || !resp.data) {
        throw new Error(resp.error || 'Translation request failed');
      }
      return resp.data;
    } finally {
      chrome.runtime.onMessage.removeListener(listener);
    }
  }

  const resp = await sendMessageToBackground<TranslationResponse>({
    type: 'TRANSLATE_SEGMENTS',
    payload: request,
  });

  if (!resp.success || !resp.data) {
    throw new Error(resp.error || 'Translation request failed');
  }

  return resp.data;
}

export async function fetchSettings(): Promise<ExtensionSettings> {
  const resp = await sendMessageToBackground<ExtensionSettings>({
    type: 'GET_SETTINGS',
  });
  if (!resp.success || !resp.data) {
    throw new Error(resp.error || 'Failed to fetch settings');
  }
  return resp.data;
}

export async function updateSettings(
  partial: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const resp = await sendMessageToBackground<ExtensionSettings>({
    type: 'UPDATE_SETTINGS',
    payload: partial,
  });
  if (!resp.success || !resp.data) {
    throw new Error(resp.error || 'Failed to update settings');
  }
  return resp.data;
}

export async function testProviderConnection(
  profile: TranslationProviderConfig
): Promise<{ durationMs: number; sampleTranslation: string }> {
  const resp = await sendMessageToBackground<{ durationMs: number; sampleTranslation: string }>({
    type: 'TEST_PROVIDER_CONNECTION',
    payload: { profile },
  });
  if (!resp.success || !resp.data) {
    throw new Error(resp.error || 'Connection test failed');
  }
  return resp.data;
}

export async function queryCurrentPageStatus(): Promise<PageTranslationStatus | null> {
  const tabId = await getActiveTabId();
  if (!tabId) return null;
  const resp = await sendMessageToTab<PageTranslationStatus>(tabId, {
    type: 'GET_PAGE_STATUS',
  });
  return resp.data || null;
}

export async function toggleCurrentPageTranslation(
  enabled: boolean,
  targetLanguage?: string
): Promise<boolean> {
  const tabId = await getActiveTabId();
  if (!tabId) return false;
  const resp = await sendMessageToTab<boolean>(tabId, {
    type: 'TOGGLE_PAGE_TRANSLATION',
    payload: { enabled, targetLanguage },
  });
  return Boolean(resp.success);
}

export async function fetchModels(
  baseUrl: string,
  apiKey?: string,
  protocol?: string
): Promise<string[]> {
  const resp = await sendMessageToBackground<{ models: string[] }>({
    type: 'FETCH_MODELS',
    payload: { baseUrl, apiKey, protocol },
  });
  if (!resp.success || !resp.data) {
    throw new Error(resp.error || '获取模型列表失败');
  }
  return resp.data.models;
}

export async function setPageDisplayMode(
  mode: 'bilingual' | 'translation-only' | 'original-only'
): Promise<boolean> {
  const tabId = await getActiveTabId();
  if (!tabId) return false;
  const resp = await sendMessageToTab<string>(tabId, {
    type: 'SET_DISPLAY_MODE',
    payload: { mode },
  });
  return Boolean(resp.success);
}

