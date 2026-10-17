import type {
  AsrCue,
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
  TranslationSegmentResult,
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
  | 'SUBTITLES_START'
  | 'SUBTITLES_STOP'
  | 'SUBTITLES_UPLOAD'
  | 'GET_SUBTITLE_STATUS'
  | 'CLOUD_TRANSLATE_CUES'
  | 'SUBTITLE_CUE_TRANSLATED'
  | 'ASR_START'
  | 'ASR_STOP'
  | 'ASR_EVENT'
  | 'FETCH_SUBTITLE_TRACK'
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

// ------------------------------------------------------------ 视频字幕 / ASR

export type SubtitleSource = 'embedded' | 'site' | 'upload' | 'asr' | null;

export interface SubtitleRuntimeStatus {
  active: boolean;
  source: SubtitleSource;
  cueCount: number;
  translatedCount: number;
  error?: string;
}

export interface StartSubtitlesMessage
  extends BaseMessage<'SUBTITLES_START', { targetLanguage?: string }> {}

export interface StopSubtitlesMessage extends BaseMessage<'SUBTITLES_STOP', void> {}

/** Content Script 内解析上传的 SRT/VTT 文本并接管字幕。 */
export interface UploadSubtitlesMessage
  extends BaseMessage<'SUBTITLES_UPLOAD', { text: string; filename?: string }> {}

export interface GetSubtitleStatusMessage extends BaseMessage<'GET_SUBTITLE_STATUS', void> {}

/** Content → Background：把一批 cue 交给云端流式翻译。 */
export interface CloudTranslateCuesMessage
  extends BaseMessage<
    'CLOUD_TRANSLATE_CUES',
    Pick<TranslationRequest, 'requestId' | 'sourceLanguage' | 'targetLanguage' | 'segments'>
  > {}

/** Background → Content：单条 cue 译文到达。 */
export interface SubtitleCueTranslatedMessage
  extends BaseMessage<
    'SUBTITLE_CUE_TRANSLATED',
    { requestId: string; segment: TranslationSegmentResult }
  > {}

export interface AsrStartMessage
  extends BaseMessage<'ASR_START', { targetLanguage?: string }> {}

export interface AsrStopMessage extends BaseMessage<'ASR_STOP', void> {}

export interface AsrEventPayload {
  kind: 'started' | 'cue' | 'translation' | 'final' | 'error';
  sessionId?: string;
  cue?: AsrCue;
  cueId?: string;
  translation?: string;
  durationSec?: number;
  error?: { code: string; message: string };
}

/** Offscreen → Background → Content：ASR 生命周期事件。 */
export interface AsrEventMessage extends BaseMessage<'ASR_EVENT', AsrEventPayload> {}

/** Content → Background：抓取站点字幕轨（仅允许受控域名，防 SSRF）。 */
export interface FetchSubtitleTrackMessage
  extends BaseMessage<'FETCH_SUBTITLE_TRACK', { url: string }> {}

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
  | StartSubtitlesMessage
  | StopSubtitlesMessage
  | UploadSubtitlesMessage
  | GetSubtitleStatusMessage
  | CloudTranslateCuesMessage
  | SubtitleCueTranslatedMessage
  | AsrStartMessage
  | AsrStopMessage
  | AsrEventMessage
  | FetchSubtitleTrackMessage
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
