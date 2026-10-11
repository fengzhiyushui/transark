import type {
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
  TranslationSegmentResult,
} from '@translate/contracts';
import {
  alignTranslationResults,
  ErrorCode,
  createAppError,
} from '@translate/contracts';
import type { TranslationProvider } from './types';

export class AnthropicAdapter implements TranslationProvider {
  public readonly config: TranslationProviderConfig;

  constructor(config: TranslationProviderConfig) {
    this.config = config;
  }

  private resolveEndpoint(): string {
    const rawBase = (this.config.baseUrl || 'https://api.anthropic.com/v1').trim().replace(/\/+$/, '');
    if (rawBase.endsWith('/messages')) {
      return rawBase;
    }
    return `${rawBase}/messages`;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...this.config.customHeaders,
    };

    const apiKey = this.config.auth.apiKey || this.config.auth.token;
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    return headers;
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResponse> {
    const endpoint = this.resolveEndpoint();
    const headers = this.buildHeaders();
    const startTime = performance.now();

    const systemPrompt = `Translate each segment into ${request.targetLanguage}. Output ONLY a JSON object: {"segments":[{"id":"segment-id","translation":"translated-text"}]}. Do NOT include markdown code fences (\`\`\`json) or extra conversational text.`;

    const userPayload = {
      segments: request.segments.map((s) => ({ id: s.id, text: s.text })),
      targetLanguage: request.targetLanguage,
    };

    const bodyPayload = {
      model: this.config.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      temperature: request.options?.temperature ?? 0.1,
    };

    let fetchResponse: Response;
    try {
      fetchResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
        signal,
      });
    } catch (networkErr: any) {
      if (signal?.aborted) {
        throw createAppError(ErrorCode.CANCELLED, 'Anthropic translation was cancelled');
      }
      throw createAppError(
        ErrorCode.NETWORK_ERROR,
        `Network error contacting Anthropic Claude at ${endpoint}: ${networkErr.message}`,
        { endpoint }
      );
    }

    if (!fetchResponse.ok) {
      let errText = '';
      try {
        errText = await fetchResponse.text();
      } catch {
        // ignore
      }

      const status = fetchResponse.status;
      if (status === 401 || status === 403) {
        throw createAppError(ErrorCode.AUTH_FAILED, `Claude API Key 认证失败 (${status}): ${errText}`);
      }
      if (status === 429) {
        throw createAppError(ErrorCode.RATE_LIMITED, `Claude API 速率超限 (429): ${errText}`);
      }
      throw createAppError(
        ErrorCode.INTERNAL_ERROR,
        `Claude 请求失败 HTTP ${status}: ${errText}`
      );
    }

    const json = await fetchResponse.json();
    const textBlock = json.content?.find((c: any) => c.type === 'text');
    let rawContent: string = textBlock?.text || '';

    // 清洗代码块标记
    let cleaned = rawContent.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsedSegments: TranslationSegmentResult[] = [];
    try {
      const parsedObj = JSON.parse(cleaned);
      if (Array.isArray(parsedObj.segments)) {
        parsedSegments = parsedObj.segments;
      } else if (Array.isArray(parsedObj)) {
        parsedSegments = parsedObj;
      }
    } catch (err) {
      throw createAppError(
        ErrorCode.ALIGNMENT_MISMATCH,
        `Claude 返回内容未能解析为标准 JSON: ${rawContent}`
      );
    }

    const alignedSegments = alignTranslationResults(request, {
      requestId: request.requestId,
      segments: parsedSegments,
    });

    const durationMs = Math.round(performance.now() - startTime);

    return {
      requestId: request.requestId,
      segments: alignedSegments,
      resolvedEngine: {
        id: this.config.model || 'claude-3-5-sonnet',
        revision: `anthropic-rev-${this.config.revision || 1}`,
        actualLocation: 'cloud',
      },
      metrics: {
        durationMs,
      },
    };
  }

  async testConnection(): Promise<{ durationMs: number; sampleTranslation: string }> {
    const start = performance.now();
    const res = await this.translate({
      requestId: `test-${Date.now()}`,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'test-1', text: 'Hello, world!' }],
    });

    return {
      durationMs: Math.round(performance.now() - start),
      sampleTranslation: res.segments[0]?.translation || '测试成功',
    };
  }
}
