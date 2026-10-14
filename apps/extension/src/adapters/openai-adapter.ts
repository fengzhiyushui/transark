import type { TranslationRequest } from '@translate/contracts';
import { ApiAdapterBase, type ResolvedLocation } from './base-adapter.ts';

/**
 * OpenAI 协议适配器，覆盖两种官方形态：
 *
 * - `openai-chat` → `POST {base}/chat/completions`
 *   事实标准，覆盖 DeepSeek、月之暗面 (Kimi)、通义千问、智谱、硅基流动、
 *   百川、vLLM、LM Studio、One-API / New-API 等绝大多数兼容网关。
 *
 * - `openai-responses` → `POST {base}/responses`
 *   OpenAI 新一代 Responses API，入参为 `input` 消息数组，
 *   输出文本位于 `output[].content[].text`（聚合 `output_text` 亦可）。
 */
export class OpenAIChatAdapter extends ApiAdapterBase {
  private get isResponsesApi(): boolean {
    return this.config.protocol === 'openai-responses';
  }

  protected resolveEndpoint(): string {
    const base = this.normalizedBase('https://api.openai.com/v1');
    if (this.isResponsesApi) {
      return base.endsWith('/responses') ? base : `${base}/responses`;
    }
    return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  }

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.customHeaders,
    };

    const key = this.apiKey();
    if (key) {
      if (this.config.auth.headerName) {
        headers[this.config.auth.headerName] = key;
      } else {
        headers['Authorization'] = `Bearer ${key}`;
      }
    }

    return headers;
  }

  protected buildPayload(request: TranslationRequest): unknown {
    const temperature = request.options?.temperature ?? 0.1;
    const model = this.config.model;

    if (this.isResponsesApi) {
      // Responses API：instructions + input，结构化输出用 text.format
      return {
        model,
        instructions: this.systemPrompt(request),
        input: JSON.stringify({ segments: this.segmentPayload(request) }),
        temperature,
        text: { format: { type: 'json_object' } },
      };
    }

    // Chat Completions：messages，配合 response_format 约束 JSON
    const payload: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: this.systemPrompt(request) },
        {
          role: 'user',
          content: JSON.stringify({
            segments: this.segmentPayload(request),
            targetLanguage: request.targetLanguage,
          }),
        },
      ],
      temperature,
    };

    // 并非所有兼容网关都支持 response_format，仅在显式开启结构化输出时下发
    if (this.config.capabilities?.structuredOutput) {
      payload.response_format = { type: 'json_object' };
    }

    return payload;
  }

  protected extractContent(json: any): string {
    if (this.isResponsesApi) {
      // 优先取官方聚合字段
      if (typeof json?.output_text === 'string' && json.output_text) {
        return json.output_text;
      }
      // 回退：遍历 output[].content[] 收集 text
      const chunks: string[] = [];
      for (const item of json?.output ?? []) {
        for (const part of item?.content ?? []) {
          if (typeof part?.text === 'string') {
            chunks.push(part.text);
          }
        }
      }
      return chunks.join('');
    }

    // Chat Completions
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content;
    }
    // 部分网关以数组形式返回 content parts
    if (Array.isArray(content)) {
      return content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('');
    }
    return '';
  }

  protected extractUsage(json: any): { promptTokens?: number; completionTokens?: number } {
    if (this.isResponsesApi) {
      return {
        promptTokens: json?.usage?.input_tokens,
        completionTokens: json?.usage?.output_tokens,
      };
    }
    return {
      promptTokens: json?.usage?.prompt_tokens,
      completionTokens: json?.usage?.completion_tokens,
    };
  }

  protected engineId(): string {
    return this.config.model || 'openai-model';
  }

  protected actualLocation(): ResolvedLocation {
    return this.inferLocation();
  }

  /**
   * 两种形态的流式事件结构不同：
   * - Chat Completions: `choices[0].delta.content`
   * - Responses API:    `type === 'response.output_text.delta'` 的 `delta`
   */
  protected extractStreamDelta(payload: any): string | null {
    if (this.isResponsesApi) {
      if (payload?.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
        return payload.delta;
      }
      return null;
    }

    const delta = payload?.choices?.[0]?.delta?.content;
    return typeof delta === 'string' ? delta : null;
  }

  protected buildStreamPayload(request: TranslationRequest): unknown {
    const payload = this.buildPayload(request) as Record<string, unknown>;
    payload.stream = true;

    if (!this.isResponsesApi) {
      // 部分兼容网关在 stream 模式下不支持 response_format，移除以免报错
      delete payload.response_format;
    }
    return payload;
  }
}
