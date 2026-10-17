import type { TranslationProviderConfig } from '@translate/contracts';

/**
 * 默认接入配置。
 *
 * 项目仅保留 API 接入：第三方云端大模型服务或 OpenAI 兼容网关，
 * 按 `protocol` 选择具体适配器。
 */

/** API 接入：OpenAI Chat Completions（事实标准，覆盖面最广） */
export const DEFAULT_OPENAI_CHAT_PROFILE: TranslationProviderConfig = {
  profileId: 'api-openai-chat',
  revision: 1,
  name: 'API 接入 · OpenAI 兼容协议',
  protocol: 'openai-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  auth: { type: 'bearer', apiKey: '' },
  dataPolicy: 'allow-cloud',
  deploymentLocation: 'cloud',
  processingLocation: 'cloud',
  capabilities: {
    textTranslation: true,
    ocr: false,
    asr: false,
    streaming: true,
    structuredOutput: true,
  },
  limits: {
    maxBatchSize: 20,
    rateLimitRpm: 60,
    timeoutMs: 30000,
  },
  isDefault: true,
  enabled: true,
};

/** API 接入：Anthropic Messages（Claude 官方） */
export const DEFAULT_ANTHROPIC_PROFILE: TranslationProviderConfig = {
  profileId: 'api-anthropic-messages',
  revision: 1,
  name: 'API 接入 · Anthropic Messages (Claude)',
  protocol: 'anthropic-messages',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-3-5-sonnet-20241022',
  auth: { type: 'api-key', apiKey: '' },
  dataPolicy: 'allow-cloud',
  deploymentLocation: 'cloud',
  processingLocation: 'cloud',
  capabilities: {
    textTranslation: true,
    ocr: false,
    asr: false,
    streaming: true,
    structuredOutput: true,
  },
  limits: {
    maxBatchSize: 20,
    timeoutMs: 30000,
  },
  isDefault: false,
  enabled: true,
};

/** API 接入：Google Gemini */
export const DEFAULT_GEMINI_PROFILE: TranslationProviderConfig = {
  profileId: 'api-gemini-generate',
  revision: 1,
  name: 'API 接入 · Google Gemini',
  protocol: 'gemini-generate',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-2.5-flash',
  auth: { type: 'api-key', apiKey: '' },
  dataPolicy: 'allow-cloud',
  deploymentLocation: 'cloud',
  processingLocation: 'cloud',
  capabilities: {
    textTranslation: true,
    ocr: false,
    asr: false,
    streaming: true,
    structuredOutput: true,
  },
  limits: {
    maxBatchSize: 20,
    timeoutMs: 30000,
  },
  isDefault: false,
  enabled: true,
};

/** API 接入：OpenAI Responses API（新一代） */
export const DEFAULT_OPENAI_RESPONSES_PROFILE: TranslationProviderConfig = {
  profileId: 'api-openai-responses',
  revision: 1,
  name: 'API 接入 · OpenAI Responses API',
  protocol: 'openai-responses',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  auth: { type: 'bearer', apiKey: '' },
  dataPolicy: 'allow-cloud',
  deploymentLocation: 'cloud',
  processingLocation: 'cloud',
  capabilities: {
    textTranslation: true,
    ocr: false,
    asr: false,
    streaming: true,
    structuredOutput: true,
  },
  limits: {
    maxBatchSize: 20,
    timeoutMs: 30000,
  },
  isDefault: false,
  enabled: true,
};

export const DEFAULT_PROFILES: TranslationProviderConfig[] = [
  DEFAULT_OPENAI_CHAT_PROFILE,
  DEFAULT_ANTHROPIC_PROFILE,
  DEFAULT_GEMINI_PROFILE,
  DEFAULT_OPENAI_RESPONSES_PROFILE,
];
