/**
 * 数据安全与传输策略：
 * - 'device-only': 严格设备本地处理，不允许任何局域网或公网传输
 * - 'allow-lan': 允许局域网内部自建或内网服务处理，不允许公网
 * - 'allow-cloud': 允许公网云端服务或外部 API 处理
 */
export type DataPolicy = 'device-only' | 'allow-lan' | 'allow-cloud';

/**
 * API 通信协议（仅保留市面上主流的四种大模型 API 形式）：
 * - 'openai-chat': OpenAI Chat Completions (/v1/chat/completions)
 *   事实标准，覆盖 DeepSeek、月之暗面、通义千问、硅基流动、
 *   vLLM / LM Studio / One-API 等绝大多数云端与自建网关。
 * - 'openai-responses': OpenAI Responses API (/v1/responses)
 * - 'anthropic-messages': Anthropic Messages (/v1/messages)
 * - 'gemini-generate': Google Gemini generateContent (/v1beta/models/{model}:generateContent)
 */
export type ApiProtocol =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini-generate';

/**
 * 通信协议与适配器标识（含自定义协议占位，便于向前兼容）。
 */
export type TranslationProtocol = ApiProtocol | (string & {});

/**
 * 译文页面展示呈现模式：
 * - 'bilingual': 双语对照 (原文在上/左，译文在下/右)
 * - 'translation-only': 仅显示译文 (隐藏原始外语文字)
 * - 'original-only': 仅显示原文 (隐藏所有译文容器)
 */
export type DisplayMode = 'bilingual' | 'translation-only' | 'original-only';

/**
 * 服务接口部署位置（网络拓扑维度）
 */
export type DeploymentLocation = 'loopback' | 'lan' | 'cloud' | 'unverified';

/**
 * 实际物理处理与推理位置（数据安全维度）
 */
export type ProcessingLocation = 'local' | 'lan' | 'cloud' | 'unverified';

/**
 * 鉴权类型
 */
export type AuthType = 'none' | 'bearer' | 'api-key' | 'custom';

/**
 * 服务凭据与认证配置
 */
export interface ProviderAuthConfig {
  /** 鉴权方案类型 */
  type: AuthType;
  /** 受保护凭据的存储引用标识（推荐，避免明文落盘） */
  secretRef?: string;
  /** 临时或明文 Token（Bearer 模式下使用） */
  token?: string;
  /** API Key（例如 x-api-key） */
  apiKey?: string;
  /** 自定义鉴权 Header 键名 */
  headerName?: string;
}

/**
 * 服务端点能力声明
 */
export interface ProviderCapabilities {
  /** 是否支持文本翻译 */
  textTranslation: boolean;
  /** 是否支持 OCR 图片文字提取与坐标识别 */
  ocr: boolean;
  /** 是否支持 ASR 音频识别与字幕时间戳 */
  asr: boolean;
  /** 是否支持按词/句精确时间戳 */
  timestamps?: boolean;
  /** 是否支持 SSE / Chunk 流式输出 */
  streaming?: boolean;
  /** 是否支持 JSON Schema / 严格结构化输出 */
  structuredOutput?: boolean;
  /** 是否支持长任务异步轮询与事件通知 (jobs API) */
  asyncJobs?: boolean;
}

/**
 * 请求限额与资源配额约束
 */
export interface ProviderLimits {
  /** 单次批处理允许的最大段落数 */
  maxBatchSize?: number;
  /** 单次请求最大输入字符数或 Token 数（约束「发出去」的内容） */
  maxInputLength?: number;
  /**
   * 单次请求允许生成的最大 Token 数（约束「收回来」的内容）。
   *
   * 与 `maxInputLength` 语义相反，不可混用：输入上限用于裁剪请求，
   * 输出上限用于防止模型输出被截断。翻译场景下译文长度与原文同量级，
   * 因此默认值需按批内原文总量估算。
   */
  maxOutputTokens?: number;
  /** 最大并发请求数 */
  concurrency?: number;
  /** 单次请求超时时间 (毫秒) */
  timeoutMs?: number;
  /** 每分钟请求频率限制 (RPM) */
  rateLimitRpm?: number;
}

/**
 * 翻译服务提供者配置实体
 */
export interface TranslationProviderConfig {
  /** 唯一配置 Profile 标识（如 'api-deepseek', 'local-gateway'） */
  profileId: string;
  /** 配置版本号，修改配置时递增以隔离缓存与旧任务 */
  revision: number;
  /** 人类可读的服务名称 */
  name: string;
  /** 适配器通信协议 */
  protocol: TranslationProtocol;
  /** API 基础根路径（保留反向代理子路径，如 https://api.deepseek.com/v1） */
  baseUrl: string;
  /** 使用的模型标识或网关别名（如 'deepseek-chat', 'gpt-4o-mini'） */
  model: string;
  /** 鉴权凭据配置 */
  auth: ProviderAuthConfig;
  /** 数据隐私策略 */
  dataPolicy: DataPolicy;
  /** 接口部署拓扑位置 */
  deploymentLocation?: DeploymentLocation;
  /** 实际物理处理位置 */
  processingLocation?: ProcessingLocation;
  /** 服务能力声明 */
  capabilities: ProviderCapabilities;
  /** 配额与限制 */
  limits?: ProviderLimits;
  /** 附加请求头 */
  customHeaders?: Record<string, string>;
  /** 是否为默认提供者 */
  isDefault?: boolean;
  /** 是否启用 */
  enabled?: boolean;
}
