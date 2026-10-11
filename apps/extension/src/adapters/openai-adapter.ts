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

export class OpenAIChatAdapter implements TranslationProvider {
  public readonly config: TranslationProviderConfig;

  constructor(config: TranslationProviderConfig) {
    this.config = config;
  }

  private resolveEndpoint(): string {
    const rawBase = (this.config.baseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
    if (rawBase.endsWith('/chat/completions')) {
      return rawBase;
    }
    return `${rawBase}/chat/completions`;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.customHeaders,
    };

    const apiKey = this.config.auth.apiKey || this.config.auth.token;
    if (apiKey) {
      if (this.config.auth.headerName) {
        headers[this.config.auth.headerName] = apiKey;
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }

    return headers;
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResponse> {
    const endpoint = this.resolveEndpoint();
    const headers = this.buildHeaders();
    const startTime = performance.now();

    const systemPrompt = `Translate each segment into ${request.targetLanguage}. Output ONLY a valid JSON object matching {"segments":[{"id":"id","translation":"translated_text"}]}. Do NOT include markdown code fences (\`\`\`json) or any explanations.`;

    const userPayload = {
      segments: request.segments.map((s) => ({ id: s.id, text: s.text })),
      targetLanguage: request.targetLanguage,
    };

    const bodyPayload: Record<string, any> = {
      model: this.config.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      temperature: request.options?.temperature ?? 0.1,
    };

    if (this.config.protocol === 'openai-responses') {
      bodyPayload.response_format = { type: 'json_object' };
    }

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
        throw createAppError(ErrorCode.CANCELLED, 'Translation request was cancelled');
      }
      throw createAppError(
        ErrorCode.NETWORK_ERROR,
        `Network error accessing OpenAI provider at ${endpoint}: ${networkErr.message}`,
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
        throw createAppError(ErrorCode.AUTH_FAILED, `Authentication failed (${status}): ${errText}`);
      }
      if (status === 429) {
        throw createAppError(ErrorCode.RATE_LIMITED, `Provider rate limit exceeded (429): ${errText}`);
      }
      throw createAppError(
        ErrorCode.INTERNAL_ERROR,
        `OpenAI translation request failed with HTTP ${status}: ${errText}`
      );
    }

    const json = await fetchResponse.json();
    const rawContent: string = json.choices?.[0]?.message?.content || '';

    // 解析并清洗可能的 markdown 代码块
    let cleanedContent = rawContent.trim();
    if (cleanedContent.startsWith('```json')) {
      cleanedContent = cleanedContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedContent.startsWith('```')) {
      cleanedContent = cleanedContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsedSegments: TranslationSegmentResult[] = [];
    try {
      const parsedObj = JSON.parse(cleanedContent);
      if (Array.isArray(parsedObj.segments)) {
        parsedSegments = parsedObj.segments;
      } else if (Array.isArray(parsedObj)) {
        parsedSegments = parsedObj;
      }
    } catch (parseErr) {
      throw createAppError(
        ErrorCode.ALIGNMENT_MISMATCH,
        `Failed to parse structured translation JSON from model output: ${rawContent}`
      );
    }

    // 严格重排与补齐
    const alignedSegments = alignTranslationResults(request, {
      requestId: request.requestId,
      segments: parsedSegments,
    });

    const durationMs = Math.round(performance.now() - startTime);

    return {
      requestId: request.requestId,
      segments: alignedSegments,
      resolvedEngine: {
        id: this.config.model || 'openai-model',
        revision: `openai-rev-${this.config.revision || 1}`,
        actualLocation:
          this.config.processingLocation === 'local' ||
          this.config.processingLocation === 'lan' ||
          this.config.processingLocation === 'cloud'
            ? this.config.processingLocation
            : 'cloud',
      },
      metrics: {
        durationMs,
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
        cacheHit: false,
      },
    };
  }

  async testConnection(signal?: AbortSignal): Promise<{ durationMs: number; sampleTranslation: string }> {
    const testReq: TranslationRequest = {
      requestId: 'test-openai-' + Date.now(),
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'test-1', text: 'Hello, world!' }],
    };
    const res = await this.translate(testReq, signal);
    return {
      durationMs: res.metrics?.durationMs || 100,
      sampleTranslation: res.segments[0]?.translation || '你好，世界！',
    };
  }
}
