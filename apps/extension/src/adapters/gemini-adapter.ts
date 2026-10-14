import type { TranslationRequest } from '@translate/contracts';
import { ApiAdapterBase, type ResolvedLocation } from './base-adapter.ts';

/**
 * Google Gemini (generativelanguage) 协议适配器。
 *
 * - 端点：`POST {base}/models/{model}:generateContent`
 *   默认 base 为 `https://generativelanguage.googleapis.com/v1beta`
 * - 鉴权：`x-goog-api-key` 请求头（也支持 `?key=` 查询参数，此处用头部更安全）
 * - 系统提示词位于顶层 `systemInstruction`
 * - 内容位于 `contents[].parts[]`
 * - JSON 结构化输出通过 `generationConfig.responseMimeType = 'application/json'` 约束
 * - 输出文本位于 `candidates[0].content.parts[].text`
 * - 安全过滤可能在 `promptFeedback` / `finishReason` 中体现，需显式报错
 */
export class GeminiAdapter extends ApiAdapterBase {
  protected resolveEndpoint(): string {
    const base = this.normalizedBase('https://generativelanguage.googleapis.com/v1beta');
    const model = encodeURIComponent(this.config.model || 'gemini-2.0-flash');

    // 若用户已填写完整方法路径，则直接使用
    if (base.endsWith(':generateContent')) {
      return base;
    }

    // base 形如 https://generativelanguage.googleapis.com/v1beta/models
    if (base.endsWith('/models')) {
      return `${base}/${model}:generateContent`;
    }

    return `${base}/models/${model}:generateContent`;
  }

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.customHeaders,
    };

    const key = this.apiKey();
    if (key) {
      headers[this.config.auth.headerName || 'x-goog-api-key'] = key;
    }

    return headers;
  }

  protected buildPayload(request: TranslationRequest): unknown {
    const payload: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: this.systemPrompt(request) }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                segments: this.segmentPayload(request),
                targetLanguage: request.targetLanguage,
              }),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: request.options?.temperature ?? 0.1,
      },
    };

    // Gemini 通过 responseMimeType 约束返回 JSON
    if (this.config.capabilities?.structuredOutput !== false) {
      (payload.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
    }

    return payload;
  }

  protected extractContent(json: any): string {
    // 提示词被安全策略拦截时，candidates 为空
    const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
    if (candidates.length === 0) {
      const blockReason = json?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new Error(`Gemini 拒绝了本次请求（blockReason: ${blockReason}）`);
      }
      return '';
    }

    const parts = candidates[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return '';
    }
    return parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }

  protected extractUsage(json: any): { promptTokens?: number; completionTokens?: number } {
    return {
      promptTokens: json?.usageMetadata?.promptTokenCount,
      completionTokens: json?.usageMetadata?.candidatesTokenCount,
    };
  }

  protected engineId(): string {
    return this.config.model || 'gemini-model';
  }

  protected actualLocation(): ResolvedLocation {
    return this.inferLocation();
  }

  /**
   * Gemini 流式：使用 `:streamGenerateContent` + `alt=sse`，
   * 每个事件是一个完整 GenerateContentResponse，文本位于
   * `candidates[0].content.parts[].text`。
   */
  protected resolveStreamEndpoint(): string {
    if (this.supportsStreaming()) {
      return this.resolveEndpoint().replace(':generateContent', ':streamGenerateContent') + '?alt=sse';
    }
    return this.resolveEndpoint();
  }

  protected extractStreamDelta(payload: any): string | null {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    const text = parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
    return text || null;
  }

  protected buildStreamPayload(request: TranslationRequest): unknown {
    // Gemini 流式由 URL 上的 :streamGenerateContent + alt=sse 控制，请求体不变
    return this.buildPayload(request);
  }
}
