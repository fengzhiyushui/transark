import type { TranslationProviderConfig } from '@translate/contracts';

export const DEFAULT_MOCK_PROFILE: TranslationProviderConfig = {
  profileId: 'mock-offline-default',
  revision: 1,
  name: '内置极速模拟 (Mock 离线免配置)',
  protocol: 'mock' as any,
  baseUrl: 'internal://mock',
  model: 'mock-engine-v1',
  auth: {
    type: 'none',
  },
  dataPolicy: 'device-only',
  deploymentLocation: 'loopback',
  processingLocation: 'local',
  capabilities: {
    textTranslation: true,
    ocr: true,
    asr: true,
    timestamps: true,
    streaming: false,
    structuredOutput: true,
  },
  limits: {
    maxBatchSize: 20,
    timeoutMs: 5000,
  },
  isDefault: true,
  enabled: true,
};

export const DEFAULT_OLLAMA_PROFILE: TranslationProviderConfig = {
  profileId: 'local-ollama-qwen',
  revision: 1,
  name: 'Ollama 本地大模型 (Qwen 2.5 7B)',
  protocol: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:7b',
  auth: { type: 'none' },
  dataPolicy: 'device-only',
  capabilities: { textTranslation: true, ocr: false, asr: false },
};

export const DEFAULT_CHROME_BUILTIN_PROFILE: TranslationProviderConfig = {
  profileId: 'chrome-builtin-default',
  revision: 1,
  name: 'Chrome 浏览器端侧原生翻译 (内置引擎)',
  protocol: 'chrome-builtin' as any,
  baseUrl: 'chrome://builtin',
  model: 'chrome-on-device-translator',
  auth: {
    type: 'none',
  },
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
    timeoutMs: 5000,
  },
  isDefault: false,
  enabled: true,
};

export const DEFAULT_OPENAI_PROFILE: TranslationProviderConfig = {
  profileId: 'openai-compatible-default',
  revision: 1,
  name: 'OpenAI 兼容协议 (DeepSeek / OpenAI / 本地网关)',
  protocol: 'openai-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  auth: {
    type: 'bearer',
    apiKey: '',
  },
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
  isDefault: false,
  enabled: true,
};

export const DEFAULT_CLAUDE_PROFILE: TranslationProviderConfig = {
  profileId: 'anthropic-claude-default',
  revision: 1,
  name: 'Claude 官方协议 (Anthropic Messages)',
  protocol: 'anthropic-messages',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-3-5-sonnet-20241022',
  auth: {
    type: 'api-key',
    apiKey: '',
  },
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
  DEFAULT_OPENAI_PROFILE,
  DEFAULT_CLAUDE_PROFILE,
  DEFAULT_CHROME_BUILTIN_PROFILE,
  DEFAULT_MOCK_PROFILE,
];
