import { ErrorCode } from './error.js';
import type {
  TranslationSegment,
  TranslationRequest,
  TranslationResponse,
} from './translation.js';
import type { TranslationProviderConfig } from './config.js';
import type { OcrBlock, OcrRequest, OcrResponse } from './ocr.js';
import type { AsrCue, AsrRequest, AsrResponse } from './asr.js';
import {
  JobStatus,
  type JobProgressEvent,
  type JobDescriptor,
} from './job.js';

// ==================== 1. 翻译相关 Mock ====================

export const mockTranslationSegments: TranslationSegment[] = [
  {
    id: 'seg-1',
    text: 'Hello, world!',
    context: 'Page title header',
  },
  {
    id: 'seg-2',
    text: 'This is a cross-platform browser translation extension built with Manifest V3 and WXT.',
    context: 'Introduction paragraph',
  },
  {
    id: 'seg-3',
    text: 'Offline translation guarantees complete data privacy by keeping all processing on-device.',
    context: 'Privacy declaration footnote',
  },
];

export const mockTranslationRequest: TranslationRequest = {
  requestId: 'req-mock-trans-001',
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  segments: mockTranslationSegments,
  profileId: 'local-self-hosted',
  revision: 1,
  options: {
    temperature: 0.2,
    format: 'text',
    preserveTerminology: true,
  },
};

export const mockTranslationResponse: TranslationResponse = {
  requestId: 'req-mock-trans-001',
  segments: [
    {
      id: 'seg-1',
      translation: '你好，世界！',
    },
    {
      id: 'seg-2',
      translation: '这是一个采用 Manifest V3 与 WXT 构建的跨平台浏览器翻译扩展。',
    },
    {
      id: 'seg-3',
      translation: '离线翻译通过在设备本地完成所有计算处理，确保完整的数据隐私。',
    },
  ],
  resolvedEngine: {
    id: 'local/self-hosted',
    revision: 'engine-rev-20261010',
    actualLocation: 'local',
  },
  metrics: {
    durationMs: 145,
    promptTokens: 48,
    completionTokens: 62,
    cacheHit: false,
  },
};

// ==================== 2. 提供者配置 Mock ====================

/** 本地接入：本机伴随服务（device-only） */
export const mockLocalCompanionConfig: TranslationProviderConfig = {
  profileId: 'local-companion-service',
  revision: 1,
  name: 'Local Companion Service (Loopback)',
  accessMode: 'local',
  protocol: 'custom-translate',
  baseUrl: 'http://127.0.0.1:8765/v1',
  model: 'built-in-hybrid',
  auth: {
    type: 'bearer',
    secretRef: 'local-companion-pairing-token',
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
    maxBatchSize: 100,
    maxInputLength: 16000,
    concurrency: 4,
    timeoutMs: 30000,
  },
  isDefault: true,
  enabled: true,
};

/** 本地接入：本机自建推理服务 (device-only) */
export const mockOllamaConfig: TranslationProviderConfig = {
  profileId: 'local-self-hosted',
  revision: 1,
  name: 'Local Self-hosted (OpenAI-compatible)',
  accessMode: 'local',
  protocol: 'openai-chat',
  baseUrl: 'http://127.0.0.1:11434/v1',
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
    maxBatchSize: 20,
    timeoutMs: 45000,
  },
  enabled: true,
};

/** 局域网自建网关服务 (allow-lan) */
export const mockLanGatewayConfig: TranslationProviderConfig = {
  profileId: 'lan-self-hosted-gateway',
  revision: 1,
  name: 'LAN Gateway (vLLM)',
  accessMode: 'api',
  protocol: 'openai-chat',
  baseUrl: 'http://192.168.1.120:8000/v1',
  model: 'Qwen/Qwen2.5-14B-Instruct',
  auth: {
    type: 'bearer',
    token: 'lan-test-key-001',
  },
  dataPolicy: 'allow-lan',
  deploymentLocation: 'lan',
  processingLocation: 'lan',
  capabilities: {
    textTranslation: true,
    ocr: false,
    asr: false,
    streaming: true,
  },
  limits: {
    concurrency: 8,
    timeoutMs: 60000,
  },
  enabled: true,
};

/** 云端兼容 API (allow-cloud) */
export const mockCloudOpenAiConfig: TranslationProviderConfig = {
  profileId: 'cloud-openai-byok',
  revision: 1,
  name: 'OpenAI Cloud (BYOK)',
  accessMode: 'api',
  protocol: 'openai-responses',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  auth: {
    type: 'bearer',
    secretRef: 'user-openai-key-secure-ref',
  },
  dataPolicy: 'allow-cloud',
  deploymentLocation: 'cloud',
  processingLocation: 'cloud',
  capabilities: {
    textTranslation: true,
    ocr: true,
    asr: true,
    timestamps: true,
    streaming: true,
    structuredOutput: true,
  },
  limits: {
    maxBatchSize: 50,
    rateLimitRpm: 500,
    timeoutMs: 30000,
  },
  enabled: true,
};

export const mockTranslationProviderConfigs: TranslationProviderConfig[] = [
  mockLocalCompanionConfig,
  mockOllamaConfig,
  mockLanGatewayConfig,
  mockCloudOpenAiConfig,
];

// ==================== 3. OCR 相关 Mock ====================

export const mockOcrBlocks: OcrBlock[] = [
  {
    id: 'ocr-block-001',
    bbox: [32, 48, 320, 40],
    text: 'CHAPTER 1: INTRODUCTION',
    readingOrder: 0,
    confidence: 0.99,
    pageNumber: 1,
  },
  {
    id: 'ocr-block-002',
    bbox: [32, 100, 560, 180],
    text: 'Offline document processing keeps intellectual property and sensitive corporate data within local boundaries.',
    readingOrder: 1,
    confidence: 0.96,
    pageNumber: 1,
  },
  {
    id: 'ocr-block-003',
    bbox: [32, 290, 560, 90],
    text: 'Both text PDF files and scanned image documents can be parsed through reading order layout reconstruction.',
    readingOrder: 2,
    confidence: 0.94,
    pageNumber: 1,
  },
];

export const mockOcrRequest: OcrRequest = {
  requestId: 'req-mock-ocr-001',
  imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  mimeType: 'image/png',
  sourceLanguage: 'en',
};

export const mockOcrResponse: OcrResponse = {
  requestId: 'req-mock-ocr-001',
  blocks: mockOcrBlocks,
  detectedLanguage: 'en',
};

// ==================== 4. ASR 相关 Mock ====================

export const mockAsrCues: AsrCue[] = [
  {
    id: 'cue-001',
    startTime: 0.0,
    endTime: 2.85,
    text: 'Welcome to the bilingual browser translation tutorial.',
    confidence: 0.98,
    speaker: 'speaker_1',
  },
  {
    id: 'cue-002',
    startTime: 3.1,
    endTime: 6.4,
    text: 'In this session, we demonstrate real-time offline speech recognition.',
    confidence: 0.95,
    speaker: 'speaker_1',
  },
  {
    id: 'cue-003',
    startTime: 6.75,
    endTime: 10.2,
    text: 'Timestamps and audio cues remain aligned throughout media playback.',
    confidence: 0.93,
    speaker: 'speaker_1',
  },
];

export const mockAsrRequest: AsrRequest = {
  requestId: 'req-mock-asr-001',
  mediaSessionId: 'media-tab-1284-video-1',
  generation: 1,
  format: 'wav',
  sampleRate: 16000,
  sourceLanguage: 'en',
};

export const mockAsrResponse: AsrResponse = {
  requestId: 'req-mock-asr-001',
  cues: mockAsrCues,
  detectedLanguage: 'en',
  durationSec: 10.5,
};

// ==================== 5. 任务与进度 Mock ====================

export const mockJobProgressPending: JobProgressEvent = {
  jobId: 'job-doc-20261011-001',
  status: JobStatus.PENDING,
  progress: 0,
  stage: 'queued',
  message: 'Job submitted and waiting in scheduler queue',
  timestamp: 1791709554000,
};

export const mockJobProgressProcessing: JobProgressEvent = {
  jobId: 'job-doc-20261011-001',
  status: JobStatus.PROCESSING,
  progress: 45,
  stage: 'translating',
  message: 'Translating document paragraph chunks (45/100)',
  processedItems: 45,
  totalItems: 100,
  timestamp: 1791709564000,
};

export const mockJobProgressCompleted: JobProgressEvent = {
  jobId: 'job-doc-20261011-001',
  status: JobStatus.COMPLETED,
  progress: 100,
  stage: 'completed',
  message: 'Document translation completed successfully',
  processedItems: 100,
  totalItems: 100,
  timestamp: 1791709580000,
};

export const mockJobProgressFailed: JobProgressEvent = {
  jobId: 'job-doc-20261011-002',
  status: JobStatus.FAILED,
  progress: 20,
  stage: 'model-loading',
  message: 'Failed to load local whisper model weights',
  error: {
    code: ErrorCode.MODEL_UNAVAILABLE,
    message: 'whisper.cpp model weights (ggml-medium.bin) not found on device',
  },
  timestamp: 1791709585000,
};

export const mockFileTranslationJob: JobDescriptor<{ fileId: string; targetLang: string }, TranslationResponse> = {
  id: 'job-doc-20261011-001',
  type: 'file-translation',
  status: JobStatus.COMPLETED,
  createdAt: 1791709554000,
  updatedAt: 1791709580000,
  input: {
    fileId: 'doc-report-2026.docx',
    targetLang: 'zh-CN',
  },
  progress: mockJobProgressCompleted,
  result: mockTranslationResponse,
};
