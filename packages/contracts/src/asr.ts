/**
 * 语音识别字幕时间轴单元 (Cue)
 */
export interface AsrCue {
  /** 字幕段唯一标识 */
  id: string;
  /** 开始时间（单位：秒，浮点数） */
  startTime: number;
  /** 结束时间（单位：秒，浮点数） */
  endTime: number;
  /** 识别出的原文文本 */
  text: string;
  /** 识别置信度 (0.0 ~ 1.0) */
  confidence?: number;
  /** 说话人标识（多说话人分离场景） */
  speaker?: string;
}

/**
 * 语音识别请求
 */
export interface AsrRequest {
  /** 请求唯一标识 */
  requestId: string;
  /** 音频数据（Base64 或音频流切片引用） */
  audioData?: string;
  /** 关联的播放器媒体会话 ID */
  mediaSessionId?: string;
  /** 会话代次号（用户跳转或切片更新时递增） */
  generation?: number;
  /** 音频格式（如 'wav', 'pcm', 'webm'） */
  format?: 'wav' | 'pcm' | 'webm' | 'mp3';
  /** 采样率（如 16000） */
  sampleRate?: number;
  /** 期望的源语言代码 */
  sourceLanguage?: string;
}

/**
 * 语音识别响应
 */
export interface AsrResponse {
  /** 对应请求唯一标识 */
  requestId: string;
  /** 生成的带时间戳字幕片段列表 */
  cues: AsrCue[];
  /** 自动检测到的源语言 */
  detectedLanguage?: string;
  /** 本段音频总时长（秒） */
  durationSec?: number;
}
