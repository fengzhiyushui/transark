import type { ErrorCode } from './error.js';

/**
 * 统一长任务状态常量与类型定义
 */
export const JobStatus = {
  /** 排队等待处理 */
  PENDING: 'pending',
  /** 正在执行计算/推理/解析 */
  PROCESSING: 'processing',
  /** 执行成功完成 */
  COMPLETED: 'completed',
  /** 执行失败 */
  FAILED: 'failed',
  /** 已主动取消 */
  CANCELLED: 'cancelled',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/**
 * 长任务业务类型
 */
export type JobType =
  | 'file-translation'
  | 'video-asr'
  | 'document-ocr'
  | 'batch-translation'
  | (string & {});

/**
 * 统一长任务进度事件（适用于 SSE / 轮询通知）
 */
export interface JobProgressEvent {
  /** 任务唯一 ID */
  jobId: string;
  /** 当前任务状态 */
  status: JobStatus;
  /** 百分比进度 (0 ~ 100) */
  progress: number;
  /** 当前执行阶段名称（如 'parsing', 'translating', 'rendering'） */
  stage?: string;
  /** 状态描述文字 */
  message?: string;
  /** 已处理条目数量（如已翻译段落数、已处理页数） */
  processedItems?: number;
  /** 总条目数量 */
  totalItems?: number;
  /** 发生错误时的详细结构 */
  error?: {
    code: ErrorCode;
    message: string;
  };
  /** 事件产生时间戳 */
  timestamp: number;
}

/**
 * 统一长任务描述符实体
 */
export interface JobDescriptor<TInput = unknown, TResult = unknown> {
  /** 任务唯一标识 */
  id: string;
  /** 任务所属业务类型 */
  type: JobType;
  /** 当前任务状态 */
  status: JobStatus;
  /** 任务创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
  /** 任务输入参数 */
  input: TInput;
  /** 最新的进度信息 */
  progress?: JobProgressEvent;
  /** 终态结果数据 */
  result?: TResult;
  /** 终态错误信息 */
  error?: {
    code: ErrorCode;
    message: string;
  };
}

/**
 * 判断任务是否处于终态（已结束，不会再有进一步状态变更）
 */
export function isJobTerminal(status: JobStatus): boolean {
  return (
    status === JobStatus.COMPLETED ||
    status === JobStatus.FAILED ||
    status === JobStatus.CANCELLED
  );
}

/**
 * 判断任务是否处于活跃/进行中状态
 */
export function isJobActive(status: JobStatus): boolean {
  return status === JobStatus.PENDING || status === JobStatus.PROCESSING;
}
