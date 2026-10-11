import type { TranslationProviderConfig } from '@translate/contracts';

export const DEFAULT_MOCK_PROFILE: TranslationProviderConfig = {
  profileId: 'mock-offline-default',
  revision: 1,
  name: '本地模拟引擎 (离线开发与验收 Mock)',
  protocol: 'mock' as any,
  baseUrl: 'http://localhost:0',
  model: 'mock-bilingual-model-v1',
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
    streaming: true,
    structuredOutput: true,
  },
  limits: {
    maxBatchSize: 15,
    timeoutMs: 45000,
  },
  isDefault: false,
  enabled: true,
};

export const DEFAULT_OPENAI_PROFILE: TranslationProviderConfig = {
  profileId: 'cloud-openai-compatible',
  revision: 1,
  name: 'OpenAI 兼容接口 (BYOK 云端/网关)',
  protocol: 'openai-chat',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
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
    maxBatchSize: 25,
    rateLimitRpm: 60,
    timeoutMs: 30000,
  },
  isDefault: false,
  enabled: true,
};

export const DEFAULT_COMPANION_PROFILE: TranslationProviderConfig = {
  profileId: 'local-companion-service',
  revision: 1,
  name: '本地伴随全能服务 (Companion Python/C++)',
  protocol: 'custom-translate',
  baseUrl: 'http://127.0.0.1:8765/v1',
  model: 'built-in-hybrid',
  auth: {
    type: 'bearer',
    token: 'local-companion-test-token',
  },
  dataPolicy: 'device-only',
  deploymentLocation: 'loopback',
  processingLocation: 'local',
  capabilities: {
    textTranslation: true,
    ocr: true,
    asr: true,
    timestamps: true,
    streaming: true,
    structuredOutput: true,
    asyncJobs: true,
  },
  limits: {
    maxBatchSize: 50,
    timeoutMs: 30000,
  },
  isDefault: false,
  enabled: true,
};

export const DEFAULT_PROFILES: TranslationProviderConfig[] = [
  DEFAULT_MOCK_PROFILE,
  DEFAULT_OLLAMA_PROFILE,
  DEFAULT_OPENAI_PROFILE,
  DEFAULT_COMPANION_PROFILE,
];
