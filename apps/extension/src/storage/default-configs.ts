import type { TranslationProviderConfig } from '@translate/contracts';

/**
 * 默认接入配置。
 *
 * 架构上仅保留两类「接入方式」：
 * - `api`   API 接入：第三方云端大模型服务，按协议适配（本文件提供的默认项）
 * - `local` 本地接入：本机 / 内网自建服务（底层适配后续版本提供，此处仅保留入口配置）
 */

/** API 接入：OpenAI Chat Completions（事实标准，覆盖面最广） */
export const DEFAULT_OPENAI_CHAT_PROFILE: TranslationProviderConfig = {
  profileId: 'api-openai-chat',
  revision: 1,
  name: 'API 接入 · OpenAI 兼容协议',
  accessMode: 'api',
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
  accessMode: 'api',
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
  accessMode: 'api',
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
  accessMode: 'api',
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

/**
 * 本地接入占位配置。
 * 底层适配尚未提供，保留入口以便后续版本直接在此补齐实现。
 */
export const DEFAULT_LOCAL_PROFILE: TranslationProviderConfig = {
  profileId: 'local-self-hosted',
  revision: 1,
  name: '本地接入 · 本机自建服务',
  accessMode: 'local',
  protocol: 'openai-chat',
  baseUrl: 'http://127.0.0.1:8000/v1',
  model: '',
  auth: { type: 'bearer', apiKey: '' },
  dataPolicy: 'device-only',
  deploymentLocation: 'loopback',
  processingLocation: 'local',
  capabilities: {
    textTranslation: true,
    ocr: false,
    asr: false,
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
  DEFAULT_LOCAL_PROFILE,
];
