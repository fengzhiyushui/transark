import type { TranslationRequest } from '@translate/contracts';
import { ApiAdapterBase, type ResolvedLocation } from './base-adapter.ts';

/**
 * Anthropic Messages 协议适配器。
 *
 * - 端点：`POST {base}/messages`（默认 https://api.anthropic.com/v1）
 * - 鉴权：`x-api-key`（而非 Bearer）
 * - 必填版本头：`anthropic-version: 2023-06-01`
 * - 浏览器直连需开启：`anthropic-dangerous-direct-browser-access: true`
 * - 系统提示词位于顶层 `system` 字段（不在 messages 内）
 * - 输出文本位于 `content[]` 中 `type === 'text'` 的部分
 */
export class AnthropicAdapter extends ApiAdapterBase {
  private static readonly API_VERSION = '2023-06-01';

  protected resolveEndpoint(): string {
    const base = this.normalizedBase('https://api.anthropic.com/v1');
    return base.endsWith('/messages') ? base : `${base}/messages`;
  }

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': AnthropicAdapter.API_VERSION,
      // 允许从浏览器扩展环境直接调用（否则会被 CORS 预检拒绝）
      'anthropic-dangerous-direct-browser-access': 'true',
      ...this.config.customHeaders,
    };

    const key = this.apiKey();
    if (key) {
      headers[this.config.auth.headerName || 'x-api-key'] = key;
    }

    return headers;
  }

  protected buildPayload(request: TranslationRequest): unknown {
    return {
      model: this.config.model,
      // Anthropic 的 max_tokens 是「生成上限」，按批内原文量估算，
      // 不可复用 maxInputLength（那是输入上限）
      max_tokens: this.maxOutputTokens(request),
      system: this.systemPrompt(request),
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            segments: this.segmentPayload(request),
            targetLanguage: request.targetLanguage,
          }),
        },
      ],
      temperature: request.options?.temperature ?? 0.1,
    };
  }

  protected extractContent(json: any): string {
    const blocks = Array.isArray(json?.content) ? json.content : [];
    return blocks
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('');
  }

  protected extractUsage(json: any): { promptTokens?: number; completionTokens?: number } {
    return {
      promptTokens: json?.usage?.input_tokens,
      completionTokens: json?.usage?.output_tokens,
    };
  }

  protected engineId(): string {
    return this.config.model || 'claude-model';
  }

  protected actualLocation(): ResolvedLocation {
    return this.inferLocation();
  }

  /**
   * Anthropic SSE 事件：
   * - `content_block_delta` 携带 `delta.text`（text_delta 类型）
   * - `message_delta` / `message_start` 携带 usage 与元数据，无文本
   */
  protected extractStreamDelta(payload: any): string | null {
    if (payload?.type !== 'content_block_delta') return null;
    const text = payload?.delta?.text;
    return typeof text === 'string' ? text : null;
  }

  protected buildStreamPayload(request: TranslationRequest): unknown {
    return { ...(this.buildPayload(request) as Record<string, unknown>), stream: true };
  }
}
