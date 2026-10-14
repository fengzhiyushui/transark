import type {
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
  TranslationSegmentResult,
} from '@translate/contracts';
import { alignTranslationResults, ErrorCode, createAppError } from '@translate/contracts';
import type { SegmentCallback, TranslationProvider } from './types.ts';
import { IncrementalSegmentParser, extractSseDataLines } from './stream-parser.ts';

/**
 * 引擎声明的实际处理位置。
 * 与契约 `ResolvedEngineInfo.actualLocation` 保持一致（不含 unverified，
 * 因为能走到翻译执行说明位置是确定的）。
 */
export type ResolvedLocation = 'local' | 'lan' | 'cloud';

/**
 * API 协议适配器公共基类。
 *
 * 各厂商协议的差异集中在三处，由子类覆写：
 *  1. `resolveEndpoint()` —— 端点拼接规则；
 *  2. `buildHeaders()`    —— 鉴权头规则；
 *  3. `buildPayload()` / `extractContent()` —— 请求体与响应体结构。
 *
 * 其余流程（网络错误归一化、HTTP 状态码 → ErrorCode 映射、模型输出的
 * JSON 提取与清洗、段落严格对齐、metrics 组装）全部在此统一实现，
 * 避免四个适配器重复四份易漂移的逻辑。
 */
export abstract class ApiAdapterBase implements TranslationProvider {
  public readonly config: TranslationProviderConfig;

  constructor(config: TranslationProviderConfig) {
    this.config = config;
  }

  // ------------------------------------------------------------ 子类必须实现
  /** 解析最终请求端点 */
  protected abstract resolveEndpoint(): string;
  /**
   * 流式请求端点。默认与普通端点一致；
   * 部分协议（如 Gemini）流式端点与方法名不同，由子类覆写。
   */
  protected resolveStreamEndpoint(): string {
    return this.resolveEndpoint();
  }
  /** 组装请求头（含鉴权） */
  protected abstract buildHeaders(): Record<string, string>;
  /** 组装请求体 */
  protected abstract buildPayload(request: TranslationRequest): unknown;
  /** 从响应 JSON 中提取模型输出的文本内容 */
  protected abstract extractContent(json: any): string;
  /** 从响应 JSON 中提取 token 用量（可选） */
  protected extractUsage(_json: any): { promptTokens?: number; completionTokens?: number } {
    return {};
  }
  /** 引擎标识 */
  protected abstract engineId(): string;
  /** 引擎声明的实际处理位置 */
  protected abstract actualLocation(): ResolvedLocation;

  /** 是否支持流式输出（由配置声明 + 子类实现 decide） */
  protected supportsStreaming(): boolean {
    return this.config.capabilities?.streaming === true;
  }

  /**
   * 从单个 SSE data 负载中抽取「文本增量」。
   * 各协议的流式事件结构不同，由子类覆写。
   * 返回 null 表示该事件不含文本增量（如 usage/元数据事件）。
   */
  protected extractStreamDelta(_payload: any): string | null {
    return null;
  }

  /**
   * 把请求体调整为流式模式。
   * 默认实现是空操作；子类按协议补充 `stream: true` 等字段。
   */
  protected buildStreamPayload(request: TranslationRequest): unknown {
    return this.buildPayload(request);
  }

  /** 从配置推断处理位置：仅接受 local / lan / cloud，其余按云端处理 */
  protected inferLocation(): ResolvedLocation {
    const declared = this.config.processingLocation;
    if (declared === 'local' || declared === 'lan' || declared === 'cloud') {
      return declared;
    }
    return 'cloud';
  }

  // ------------------------------------------------------------ 公共工具
  /** 归一化 baseUrl：去除尾部斜杠 */
  protected normalizedBase(fallback: string): string {
    return (this.config.baseUrl || fallback).trim().replace(/\/+$/, '');
  }

  /** 取鉴权密钥（apiKey 优先，其次 token） */
  protected apiKey(): string {
    return this.config.auth?.apiKey || this.config.auth?.token || '';
  }

  /** 翻译任务的系统提示词：强制 JSON 结构化输出，与 alignTranslationResults 对齐 */
  protected systemPrompt(request: TranslationRequest): string {
    return (
      `You are a professional translation engine. Translate each segment into ` +
      `${request.targetLanguage}. Output ONLY a valid JSON object matching ` +
      `{"segments":[{"id":"segment-id","translation":"translated-text"}]}. ` +
      `Preserve the exact "id" values. Do NOT wrap the output in markdown code fences, ` +
      `and do NOT add any explanations, notes, or conversational text.`
    );
  }

  /** 待翻译的段落载荷 */
  protected segmentPayload(request: TranslationRequest) {
    return request.segments.map((s) => ({ id: s.id, text: s.text }));
  }

  /**
   * 输出 Token 预算（对应 Anthropic 的 `max_tokens`、OpenAI 的
   * `max_completion_tokens` 等「生成上限」参数）。
   *
   * 之所以不能直接复用 `maxInputLength`：后者约束的是**输入**，
   * 取值通常很大（如 16000），而输出上限一旦设得过大，部分服务会直接
   * 拒绝请求；设得过小又会截断译文。
   *
   * 这里按「批内原文量」估算：译文长度与原文同量级，中日韩等语言
   * 单字占用的 Token 更多，故按 1.8 倍系数并留出 JSON 结构开销。
   */
  protected maxOutputTokens(request: TranslationRequest): number {
    const explicit = this.config.limits?.maxOutputTokens;
    if (typeof explicit === 'number' && explicit > 0) {
      return explicit;
    }

    // 纯 ASCII 约 4 字符/token；非 ASCII 约 1.5 字符/token，取较保守估算
    const totalChars = request.segments.reduce((sum, s) => sum + (s.text?.length || 0), 0);
    const estimated = Math.ceil(totalChars / 2) * 2; // 乘 2 覆盖译文的膨胀
    const withFloor = Math.max(1024, estimated + 256);

    // 上限 8192：避免把「生成上限」设得过高而被服务端拒绝
    return Math.min(withFloor, 8192);
  }

  /**
   * 从模型原始输出中提取段落数组。
   * 容忍三种常见形态：标准对象、裸数组、以及被 markdown 围栏包裹的 JSON。
   */
  protected parseSegments(rawContent: string, providerLabel: string): TranslationSegmentResult[] {
    let cleaned = (rawContent || '').trim();

    // 清洗 markdown 代码块围栏
    if (cleaned.startsWith('```')) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
    }

    if (!cleaned) {
      throw createAppError(
        ErrorCode.ALIGNMENT_MISMATCH,
        `${providerLabel} 返回内容为空，无法解析翻译结果`
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // 兜底：尝试截取第一个 { 到最后一个 } 之间的片段
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(cleaned.slice(start, end + 1));
        } catch {
          parsed = undefined;
        }
      }
    }

    if (parsed === undefined) {
      throw createAppError(
        ErrorCode.ALIGNMENT_MISMATCH,
        `${providerLabel} 返回内容未能解析为 JSON，请确认所选模型是否支持结构化输出。原始内容片段: ${cleaned.slice(0, 200)}`
      );
    }

    if (Array.isArray(parsed?.segments)) {
      return parsed.segments;
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }

    throw createAppError(
      ErrorCode.ALIGNMENT_MISMATCH,
      `${providerLabel} 返回的 JSON 中缺少 segments 数组`
    );
  }

  /** HTTP 状态码 → 统一错误码 */
  protected raiseHttpError(status: number, errText: string, providerLabel: string): never {
    if (status === 401 || status === 403) {
      throw createAppError(
        ErrorCode.AUTH_FAILED,
        `${providerLabel} 鉴权失败 (HTTP ${status})，请检查 API Key 是否正确且具备该模型权限: ${errText}`
      );
    }
    if (status === 429) {
      throw createAppError(
        ErrorCode.RATE_LIMITED,
        `${providerLabel} 触发速率限制 (HTTP 429)，请降低并发或稍后重试: ${errText}`
      );
    }
    if (status === 404) {
      throw createAppError(
        ErrorCode.MODEL_UNAVAILABLE,
        `${providerLabel} 端点或模型不存在 (HTTP 404)，请检查 BaseUrl 与模型名称: ${errText}`
      );
    }
    if (status === 400 || status === 422) {
      throw createAppError(
        ErrorCode.INVALID_REQUEST,
        `${providerLabel} 请求参数被拒绝 (HTTP ${status})，可能是模型不支持当前参数或上下文超限: ${errText}`
      );
    }
    if (status >= 500) {
      throw createAppError(
        ErrorCode.MODEL_UNAVAILABLE,
        `${providerLabel} 服务端异常 (HTTP ${status}): ${errText}`
      );
    }
    throw createAppError(
      ErrorCode.INTERNAL_ERROR,
      `${providerLabel} 请求失败 (HTTP ${status}): ${errText}`
    );
  }

  /** 发起请求并归一化网络/HTTP 错误 */
  private async request(
    request: TranslationRequest,
    stream: boolean,
    signal?: AbortSignal
  ): Promise<Response> {
    const endpoint = stream ? this.resolveStreamEndpoint() : this.resolveEndpoint();
    const headers = this.buildHeaders();
    const body = JSON.stringify(stream ? this.buildStreamPayload(request) : this.buildPayload(request));

    let fetchResponse: Response;
    try {
      fetchResponse = await fetch(endpoint, { method: 'POST', headers, body, signal });
    } catch (networkErr: any) {
      if (signal?.aborted) {
        throw createAppError(ErrorCode.CANCELLED, '翻译请求已被取消');
      }
      throw createAppError(
        ErrorCode.NETWORK_ERROR,
        `无法连接 ${this.engineId()} (${endpoint})：${networkErr?.message || '网络异常'}`,
        { endpoint }
      );
    }

    if (!fetchResponse.ok) {
      let errText = '';
      try {
        errText = await fetchResponse.text();
      } catch {
        // 忽略读取错误正文的失败
      }
      this.raiseHttpError(fetchResponse.status, errText.slice(0, 500), this.engineId());
    }

    return fetchResponse;
  }

  /** 构造响应骨架（含引擎信息与 metrics） */
  private buildResponse(
    request: TranslationRequest,
    segments: TranslationSegmentResult[],
    durationMs: number,
    usage: { promptTokens?: number; completionTokens?: number; cacheHit?: boolean }
  ): TranslationResponse {
    return {
      requestId: request.requestId,
      segments,
      resolvedEngine: {
        id: this.engineId(),
        revision: `${this.config.protocol}-rev-${this.config.revision || 1}`,
        actualLocation: this.actualLocation(),
      },
      metrics: { durationMs, ...usage, cacheHit: usage.cacheHit ?? false },
    };
  }

  /** 统一的 translate 模板方法 */
  async translate(
    request: TranslationRequest,
    signal?: AbortSignal,
    onSegment?: SegmentCallback
  ): Promise<TranslationResponse> {
    const startTime = performance.now();

    // 有增量回调且协议支持流式 → 走流式路径（首段即回填）
    let streamedIds: Set<string> = new Set();
    if (onSegment && this.supportsStreaming()) {
      const seen = new Set<string>();
      const trackingCallback: SegmentCallback = (seg) => {
        seen.add(seg.id);
        onSegment(seg);
      };

      try {
        return await this.translateStreaming(request, signal, trackingCallback, startTime);
      } catch (err: any) {
        if (signal?.aborted) throw err;

        // 仅对「流式能力不可用」类错误回退。
        // 鉴权失败 / 限流 / 模型不存在等错误必须原样抛出：
        // 重试只会重复计费并掩盖真实原因。
        const code = err?.code;
        const recoverable =
          code === ErrorCode.INTERNAL_ERROR ||
          code === ErrorCode.NETWORK_ERROR ||
          code === undefined;
        if (!recoverable) throw err;

        console.warn(
          `[${this.engineId()}] 流式不可用，回退为非流式请求:`,
          err instanceof Error ? err.message : err
        );
        // 已回填过的段落不再重复回调，避免译文节点被重复挂载
        streamedIds = seen;
      }
    }

    const finalCallback: SegmentCallback | undefined = onSegment
      ? (seg) => {
          if (streamedIds.has(seg.id)) return;
          onSegment(seg);
        }
      : undefined;

    const fetchResponse = await this.request(request, false, signal);

    let json: any;
    try {
      json = await fetchResponse.json();
    } catch {
      throw createAppError(
        ErrorCode.INTERNAL_ERROR,
        `${this.engineId()} 返回了非 JSON 响应，请确认 BaseUrl 指向的是正确的 API 端点`
      );
    }

    const parsedSegments = this.parseSegments(this.extractContent(json), this.engineId());

    // 严格重排与补齐：缺失段落会被标记 ALIGNMENT_MISMATCH 错误段
    const alignedSegments = alignTranslationResults(request, {
      requestId: request.requestId,
      segments: parsedSegments,
    });

    // 回退路径下，把结果按段交回（跳过已流式回填的部分）
    if (finalCallback) {
      for (const seg of alignedSegments) {
        finalCallback(seg);
      }
    }

    return this.buildResponse(
      request,
      alignedSegments,
      Math.round(performance.now() - startTime),
      this.extractUsage(json)
    );
  }

  /** 流式路径：边收边解析，逐段回调；结束后再做严格对齐 */
  private async translateStreaming(
    request: TranslationRequest,
    signal: AbortSignal | undefined,
    onSegment: SegmentCallback,
    startTime: number
  ): Promise<TranslationResponse> {
    const fetchResponse = await this.request(request, true, signal);

    // 无流式 body（部分网关不支持 stream，或运行环境无 ReadableStream）：
    // 抛出可回退错误，交由 translate() 走非流式路径重试
    if (!fetchResponse.body) {
      throw createAppError(
        ErrorCode.INTERNAL_ERROR,
        `${this.engineId()} 未返回可读流，回退为非流式请求`
      );
    }

    const contentType = fetchResponse.headers?.get?.('content-type') || '';
    // 网关忽略 stream 参数直接返回整体 JSON 时，交给非流式路径处理
    if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
      const json = await fetchResponse.json();
      const parsed = this.parseSegments(this.extractContent(json), this.engineId());
      const aligned = alignTranslationResults(request, {
        requestId: request.requestId,
        segments: parsed,
      });
      for (const seg of aligned) onSegment(seg);
      return this.buildResponse(
        request,
        aligned,
        Math.round(performance.now() - startTime),
        this.extractUsage(json)
      );
    }

    const reader = fetchResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const parser = new IncrementalSegmentParser();
    const collected: TranslationSegmentResult[] = [];
    let sseBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal?.aborted) {
          throw createAppError(ErrorCode.CANCELLED, '翻译请求已被取消');
        }

        sseBuffer += decoder.decode(value, { stream: true });

        // 按 SSE 事件边界切分，保留最后一段不完整数据
        const lastBreak = sseBuffer.lastIndexOf('\n\n');
        if (lastBreak < 0) continue;
        const complete = sseBuffer.slice(0, lastBreak);
        sseBuffer = sseBuffer.slice(lastBreak + 2);

        for (const payload of extractSseDataLines(complete)) {
          let parsedEvent: any;
          try {
            parsedEvent = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = this.extractStreamDelta(parsedEvent);
          if (!delta) continue;
          for (const seg of parser.push(delta)) {
            collected.push(seg);
            onSegment(seg);
          }
        }
      }

      // 冲刷残留：处理未以 \n\n 结尾的最后一个事件
      sseBuffer += decoder.decode();
      if (sseBuffer.trim()) {
        for (const payload of extractSseDataLines(sseBuffer)) {
          try {
            const parsedEvent = JSON.parse(payload);
            const delta = this.extractStreamDelta(parsedEvent);
            if (delta) {
              for (const seg of parser.push(delta)) {
                collected.push(seg);
                onSegment(seg);
              }
            }
          } catch {
            // 忽略无法解析的尾部事件
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // 释放失败不影响结果
      }
    }

    // 严格对齐：缺失段落标记 ALIGNMENT_MISMATCH，并保证顺序与请求一致
    const aligned = alignTranslationResults(request, {
      requestId: request.requestId,
      segments: collected,
    });

    return this.buildResponse(request, aligned, Math.round(performance.now() - startTime), {});
  }

  /** 连通性测试：发一段固定样本，返回往返耗时与译文 */
  async testConnection(signal?: AbortSignal): Promise<{ durationMs: number; sampleTranslation: string }> {
    const res = await this.translate(
      {
        requestId: `test-${this.config.protocol}-${Date.now()}`,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        segments: [{ id: 'test-1', text: 'Hello, world!' }],
      },
      signal
    );
    return {
      durationMs: res.metrics?.durationMs ?? 0,
      sampleTranslation: res.segments[0]?.translation || '',
    };
  }
}
