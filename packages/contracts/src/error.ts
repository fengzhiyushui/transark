/**
 * 统一错误码体系与错误运行时工具
 */

export const ErrorCode = {
  /** 鉴权或凭据校验失败（如无效 API Key、未配对、Token 过期） */
  AUTH_FAILED: 'AUTH_FAILED',
  /** 网络连接异常、服务不可达或 DNS 解析失败 */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** 请求被限流（429 Too Many Requests 或配额超限） */
  RATE_LIMITED: 'RATE_LIMITED',
  /** 指定的模型不存在、未下载或未加载到内存 */
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  /** 请求或任务执行超时 */
  TIMEOUT: 'TIMEOUT',
  /** 违反数据隐私策略（如 device-only 模式下尝试云端请求） */
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  /** 请求参数格式无效、字段缺失或值超出约束 */
  INVALID_REQUEST: 'INVALID_REQUEST',
  /** 翻译返回的段落 ID 与请求不匹配、重复、缺失或包含未知 ID */
  ALIGNMENT_MISMATCH: 'ALIGNMENT_MISMATCH',
  /** 目标任务、文件或资源引用不存在 */
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  /** 不支持的通信协议或适配器类型 */
  UNSUPPORTED_PROTOCOL: 'UNSUPPORTED_PROTOCOL',
  /** 离线运行模式下缺少本地依赖、运行时或模型资源 */
  OFFLINE_REQUIRED: 'OFFLINE_REQUIRED',
  /** 任务被主动取消（用户触发或被新版本覆盖） */
  CANCELLED: 'CANCELLED',
  /** 内部未捕获异常或服务处理失败 */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface AppErrorDetails {
  [key: string]: unknown;
}

/**
 * 统一应用错误运行时类
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: AppErrorDetails;
  public readonly timestamp: number;

  constructor(code: ErrorCode, message: string, details?: AppErrorDetails) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    Object.setPrototypeOf(this, AppError.prototype);
  }

  public toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

/**
 * 判断是否为 AppError 实例
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * 创建 AppError 工厂函数
 */
export function createAppError(
  code: ErrorCode,
  message: string,
  details?: AppErrorDetails
): AppError {
  return new AppError(code, message, details);
}
