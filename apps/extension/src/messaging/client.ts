import type {
  ExtensionMessage,
  MessageResponse,
  PageTranslationStatus,
} from './protocol';
import type { TranslationRequest, TranslationResponse, TranslationProviderConfig } from '@translate/contracts';
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

export async function requestTranslation(
  request: TranslationRequest
): Promise<TranslationResponse> {
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
