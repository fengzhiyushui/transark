import type {
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
  DisplayMode,
} from '@translate/contracts';
import type { ExtensionSettings } from '../storage/extension-storage';

export type ExtensionMessageType =
  | 'TRANSLATE_SEGMENTS'
  | 'TRANSLATE_SEGMENT_STREAM'
  | 'GET_SETTINGS'
  | 'UPDATE_SETTINGS'
  | 'TEST_PROVIDER_CONNECTION'
  | 'FETCH_MODELS'
  | 'TOGGLE_PAGE_TRANSLATION'
  | 'SET_DISPLAY_MODE'
  | 'GET_PAGE_STATUS'
  | 'RESTORE_PAGE_ORIGINAL'
  | 'PING';

export interface BaseMessage<T extends ExtensionMessageType = ExtensionMessageType, P = unknown> {
  type: T;
  payload?: P;
}

/**
 * 翻译请求（扩展自契约 TranslationRequest）。
 * `stream: true` 表示希望 Background 逐段推送增量结果。
 * `tabId` 可选，用于让 Background 知道把增量推给哪个标签页
 * （无法从 sender 推断时使用，例如来自 Reader 独立页面的调用）。
 */
export interface TranslateSegmentsPayload extends TranslationRequest {
  stream?: boolean;
  tabId?: number;
}

export interface TranslateSegmentsMessage
  extends BaseMessage<'TRANSLATE_SEGMENTS', TranslateSegmentsPayload> {}

/**
 * 流式增量推送（Background → Content Script）。
 *
 * Chrome 的消息通道无法承载回调，因此流式翻译由两段构成：
 * 1. Content Script 发 `TRANSLATE_SEGMENTS`（携带 requestId 与 stream 标记）；
 * 2. Background 每解析出一个完整段落，就向该标签页推送一条本消息；
 * 3. 全部结束后，`TRANSLATE_SEGMENTS` 的响应才 resolve 为完整结果。
 *
 * 这样即使某个段落先到，也能立即回填，无需等待整批。
 */
export interface TranslateSegmentStreamMessage
  extends BaseMessage<
    'TRANSLATE_SEGMENT_STREAM',
    {
      requestId: string;
      segment: { id: string; translation: string; error?: { code: string; message: string } };
    }
  > {}

export interface GetSettingsMessage extends BaseMessage<'GET_SETTINGS', void> {}

export interface UpdateSettingsMessage extends BaseMessage<'UPDATE_SETTINGS', Partial<ExtensionSettings>> {}

export interface TestProviderConnectionMessage
  extends BaseMessage<'TEST_PROVIDER_CONNECTION', { profile: TranslationProviderConfig }> {}

export interface FetchModelsMessage
  extends BaseMessage<'FETCH_MODELS', { baseUrl: string; apiKey?: string; protocol?: string }> {}

export interface TogglePageTranslationMessage
  extends BaseMessage<'TOGGLE_PAGE_TRANSLATION', { enabled: boolean; targetLanguage?: string }> {}

export interface SetDisplayModeMessage
  extends BaseMessage<'SET_DISPLAY_MODE', { mode: DisplayMode }> {}

export interface GetPageStatusMessage extends BaseMessage<'GET_PAGE_STATUS', void> {}

export interface RestorePageOriginalMessage extends BaseMessage<'RESTORE_PAGE_ORIGINAL', void> {}

export interface PingMessage extends BaseMessage<'PING', void> {}

export type ExtensionMessage =
  | TranslateSegmentsMessage
  | TranslateSegmentStreamMessage
  | GetSettingsMessage
  | UpdateSettingsMessage
  | TestProviderConnectionMessage
  | FetchModelsMessage
  | TogglePageTranslationMessage
  | SetDisplayModeMessage
  | GetPageStatusMessage
  | RestorePageOriginalMessage
  | PingMessage;

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

export interface PageTranslationStatus {
  isTranslating: boolean;
  isReverted: boolean;
  totalSegments: number;
  translatedSegments: number;
  pendingSegments: number;
  targetLanguage: string;
  displayMode?: DisplayMode;
}
