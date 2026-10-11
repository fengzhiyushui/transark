import type {
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
} from '@translate/contracts';
import type { ExtensionSettings } from '../storage/extension-storage';

export type ExtensionMessageType =
  | 'TRANSLATE_SEGMENTS'
  | 'GET_SETTINGS'
  | 'UPDATE_SETTINGS'
  | 'TEST_PROVIDER_CONNECTION'
  | 'TOGGLE_PAGE_TRANSLATION'
  | 'GET_PAGE_STATUS'
  | 'RESTORE_PAGE_ORIGINAL'
  | 'PING';

export interface BaseMessage<T extends ExtensionMessageType = ExtensionMessageType, P = unknown> {
  type: T;
  payload?: P;
}

export interface TranslateSegmentsMessage extends BaseMessage<'TRANSLATE_SEGMENTS', TranslationRequest> {}

export interface GetSettingsMessage extends BaseMessage<'GET_SETTINGS', void> {}

export interface UpdateSettingsMessage extends BaseMessage<'UPDATE_SETTINGS', Partial<ExtensionSettings>> {}

export interface TestProviderConnectionMessage
  extends BaseMessage<'TEST_PROVIDER_CONNECTION', { profile: TranslationProviderConfig }> {}

export interface TogglePageTranslationMessage
  extends BaseMessage<'TOGGLE_PAGE_TRANSLATION', { enabled: boolean; targetLanguage?: string }> {}

export interface GetPageStatusMessage extends BaseMessage<'GET_PAGE_STATUS', void> {}

export interface RestorePageOriginalMessage extends BaseMessage<'RESTORE_PAGE_ORIGINAL', void> {}

export interface PingMessage extends BaseMessage<'PING', void> {}

export type ExtensionMessage =
  | TranslateSegmentsMessage
  | GetSettingsMessage
  | UpdateSettingsMessage
  | TestProviderConnectionMessage
  | TogglePageTranslationMessage
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
}
