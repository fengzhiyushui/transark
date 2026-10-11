import type { ErrorCode } from './error.js';

/**
 * 翻译文本单元
 */
export interface TranslationSegment {
  /** 单元唯一标识（例如 DOM 节点 ID、文件段落 ID、字幕 cue ID） */
  id: string;
  /** 待翻译的原文文本 */
  text: string;
  /** 上下文补充信息（前后文段落、专有名词、页面元数据等） */
  context?: string;
}

/**
 * 翻译选项配置
 */
export interface TranslationOptions {
  /** 生成温度 (0.0 ~ 1.0) */
  temperature?: number;
  /** 文本格式约定 */
  format?: 'text' | 'html' | 'markdown';
  /** 是否保留专有名词与术语对照 */
  preserveTerminology?: boolean;
  /** 页面/文档业务会话 ID，用于关联取消与代次清理 */
  sessionId?: string;
  /** 当前业务版本代次号 */
  sessionGeneration?: number;
}

/**
 * 统一翻译请求载荷
 */
export interface TranslationRequest {
  /** 请求唯一标识，用于跨端追踪与响应对齐 */
  requestId: string;
  /** 源语言代码（如 'en', 'ja', 'auto'） */
  sourceLanguage: string;
  /** 目标语言代码（如 'zh-CN', 'en'） */
  targetLanguage: string;
  /** 待翻译段落列表（严格保持 ID 唯一） */
  segments: TranslationSegment[];
  /** 绑定的服务配置 Profile ID */
  profileId?: string;
  /** 绑定的服务配置版本号（用于缓存隔离） */
  revision?: number;
  /** 请求级附加选项 */
  options?: TranslationOptions;
}

/**
 * 单个段落的翻译结果
 */
export interface TranslationSegmentResult {
  /** 对应请求中的段落 ID */
  id: string;
  /** 翻译完成的目标语言文本 */
  translation: string;
  /** 当单个段落翻译异常时携带的结构化错误信息 */
  error?: {
    code: ErrorCode;
    message: string;
  };
}

/**
 * 实际执行推理的服务/引擎信息
 */
export interface ResolvedEngineInfo {
  /** 引擎或模型标识（如 'ollama/qwen2.5:7b', 'gpt-4o-mini'） */
  id: string;
  /** 引擎或路由配置的版本标识，便于缓存隔离 */
  revision: string;
  /** 实际物理处理位置 */
  actualLocation?: 'local' | 'lan' | 'cloud';
}

/**
 * 翻译耗时与 Token 统计
 */
export interface TranslationMetrics {
  /** 推理耗时 (毫秒) */
  durationMs?: number;
  /** 输入消耗的 Token 数 */
  promptTokens?: number;
  /** 输出生成的 Token 数 */
  completionTokens?: number;
  /** 是否命中本地或服务端缓存 */
  cacheHit?: boolean;
}

/**
 * 统一翻译响应结构（要求段落与请求严格对齐）
 */
export interface TranslationResponse {
  /** 对应请求的唯一标识 */
  requestId: string;
  /** 翻译后的段落结果列表，必须与请求段落完全对齐 */
  segments: TranslationSegmentResult[];
  /** 实际承载推理的引擎信息 */
  resolvedEngine?: ResolvedEngineInfo;
  /** 性能与消耗度量指标 */
  metrics?: TranslationMetrics;
}
