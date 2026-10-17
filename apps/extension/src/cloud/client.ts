import type {
  AsrCue,
  TranslationRequest,
  TranslationResponse,
  TranslationSegmentResult,
} from '@translate/contracts';
import { extractSseDataLines } from '../adapters/stream-parser.ts';

/** 云端服务连接配置（保存在 chrome.storage.local，绝不注入网页 DOM）。 */
export interface CloudServiceConfig {
  endpoint: string;
  apiKey: string;
  enabled: boolean;
  /** 无字幕时是否允许自动启用云端 ASR */
  asrFallback: boolean;
}

export class CloudApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code = 'NETWORK_ERROR', status = 0) {
    super(message);
    this.name = 'CloudApiError';
    this.code = code;
    this.status = status;
  }
}

function baseUrl(config: CloudServiceConfig): string {
  return (config.endpoint || '').trim().replace(/\/+$/, '');
}

function authHeaders(config: CloudServiceConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };
}

export function isCloudConfigured(config: CloudServiceConfig | undefined): boolean {
  return Boolean(config?.enabled && config.endpoint && config.apiKey);
}

async function postJson<T>(
  config: CloudServiceConfig,
  path: string,
  body: unknown
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl(config)}${path}`, {
      method: 'POST',
      headers: authHeaders(config),
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    throw new CloudApiError(`无法连接云端服务：${err?.message || '网络异常'}`);
  }

  const json: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CloudApiError(
      json?.error?.message || `云端服务返回 HTTP ${response.status}`,
      json?.error?.code || 'NETWORK_ERROR',
      response.status
    );
  }
  return json as T;
}

export interface ExtractSubtitlesRequest {
  requestId: string;
  filename?: string;
  data?: string;
  text?: string;
  url?: string;
}

export interface ExtractSubtitlesResponse {
  requestId: string;
  source: string;
  cues: AsrCue[];
}

/** 云端字幕提取（SRT/VTT → cue 列表）。 */
export async function extractSubtitlesCloud(
  config: CloudServiceConfig,
  request: ExtractSubtitlesRequest
): Promise<ExtractSubtitlesResponse> {
  return postJson<ExtractSubtitlesResponse>(config, '/v1/subtitles/extract', request);
}

/**
 * 字幕翻译。
 * 传入 onSegment 时走 SSE 流式：每译出一段立即回调，最终返回完整权威结果。
 */
export async function translateCuesCloud(
  config: CloudServiceConfig,
  request: TranslationRequest,
  onSegment?: (segment: TranslationSegmentResult) => void
): Promise<TranslationResponse> {
  if (!onSegment) {
    return postJson<TranslationResponse>(
      config,
      '/v1/subtitles/translate',
      request
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl(config)}/v1/subtitles/translate?stream=true`, {
      method: 'POST',
      headers: authHeaders(config),
      body: JSON.stringify(request),
    });
  } catch (err: any) {
    throw new CloudApiError(`无法连接云端服务：${err?.message || '网络异常'}`);
  }

  if (!response.ok) {
    const json: any = await response.json().catch(() => null);
    throw new CloudApiError(
      json?.error?.message || `云端服务返回 HTTP ${response.status}`,
      json?.error?.code || 'NETWORK_ERROR',
      response.status
    );
  }
  if (!response.body) {
    throw new CloudApiError('云端服务未返回可读流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const collected: TranslationSegmentResult[] = [];
  let buffer = '';
  let finalResponse: TranslationResponse | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const payload of extractSseDataLines(block)) {
          if (payload === '[DONE]') continue;
          let event: any;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          if (event.type === 'error') {
            throw new CloudApiError(
              event.error?.message || '流式翻译失败',
              event.error?.code || 'INTERNAL_ERROR'
            );
          }
          if (event.type === 'segment' && event.segment) {
            const segment = event.segment as TranslationSegmentResult;
            collected.push(segment);
            onSegment(segment);
          } else if (event.type === 'done' && event.response) {
            finalResponse = event.response as TranslationResponse;
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 释放失败不影响结果
    }
  }

  // 冲刷末尾未以 \n\n 结尾的残留事件
  if (buffer.trim()) {
    for (const payload of extractSseDataLines(buffer)) {
      if (payload === '[DONE]') continue;
      try {
        const event = JSON.parse(payload);
        if (event.type === 'segment' && event.segment) {
          collected.push(event.segment);
          onSegment(event.segment);
        } else if (event.type === 'done' && event.response) {
          finalResponse = event.response;
        }
      } catch {
        // 忽略无法解析的尾部
      }
    }
  }

  return (
    finalResponse ?? {
      requestId: request.requestId,
      segments: collected,
    }
  );
}

// ------------------------------------------------------------------ ASR WS

export interface AsrStreamOptions {
  sessionId: string;
  sampleRate?: number;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export interface AsrStreamHandlers {
  onStarted?: (sessionId: string) => void;
  onCue?: (cue: AsrCue) => void;
  onTranslation?: (cueId: string, translation: string) => void;
  onFinal?: (durationSec: number) => void;
  onError?: (error: CloudApiError) => void;
  onClose?: () => void;
}

export interface AsrStreamHandle {
  sendPcm(data: ArrayBuffer): void;
  stop(): void;
  close(): void;
}

function websocketUrl(config: CloudServiceConfig): string {
  const base = baseUrl(config).replace(/^http/i, 'ws');
  return `${base}/v1/asr/stream`;
}

/**
 * 打开云端流式 ASR 通道。
 * WS 无法自定义请求头，因此 API Key 放在首帧 `start.token` 中。
 */
export function openAsrStream(
  config: CloudServiceConfig,
  options: AsrStreamOptions,
  handlers: AsrStreamHandlers
): AsrStreamHandle {
  const socket = new WebSocket(websocketUrl(config));
  socket.binaryType = 'arraybuffer';

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        type: 'start',
        token: config.apiKey,
        sessionId: options.sessionId,
        sampleRate: options.sampleRate ?? 16000,
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
      })
    );
  };

  socket.onmessage = (event) => {
    let message: any;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    switch (message.type) {
      case 'started':
        handlers.onStarted?.(message.sessionId);
        break;
      case 'cue':
        if (message.cue) handlers.onCue?.(message.cue as AsrCue);
        break;
      case 'translation':
        if (message.cueId && message.translation) {
          handlers.onTranslation?.(message.cueId, message.translation);
        } else if (message.error) {
          handlers.onError?.(new CloudApiError(message.error.message, message.error.code));
        }
        break;
      case 'final':
        handlers.onFinal?.(Number(message.durationSec) || 0);
        break;
      case 'error':
        handlers.onError?.(
          new CloudApiError(message.error?.message || 'ASR 失败', message.error?.code)
        );
        break;
      default:
        break;
    }
  };

  socket.onerror = () => {
    handlers.onError?.(new CloudApiError('ASR WebSocket 连接异常'));
  };
  socket.onclose = () => {
    handlers.onClose?.();
  };

  return {
    sendPcm(data: ArrayBuffer) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    },
    stop() {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
    },
    close() {
      socket.close();
    },
  };
}
