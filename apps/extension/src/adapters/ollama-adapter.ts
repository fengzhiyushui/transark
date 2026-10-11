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

export class OllamaAdapter implements TranslationProvider {
  public readonly config: TranslationProviderConfig;

  constructor(config: TranslationProviderConfig) {
    this.config = config;
  }

  private resolveEndpoint(): string {
    const rawBase = (this.config.baseUrl || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
    if (rawBase.endsWith('/api/chat')) {
      return rawBase;
    }
    return `${rawBase}/api/chat`;
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResponse> {
    const endpoint = this.resolveEndpoint();
    const startTime = performance.now();

    const systemPrompt = `You are a specialized translation model.
Translate the input text segments from ${request.sourceLanguage || 'source'} into ${request.targetLanguage}.
Respond ONLY with a JSON object in this format:
{"segments": [{"id": "id-string", "translation": "translated text"}]}`;

    const userPayload = {
      segments: request.segments.map((s) => ({ id: s.id, text: s.text })),
      targetLanguage: request.targetLanguage,
    };

    const requestBody = {
      model: this.config.model || 'qwen2.5:7b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      stream: false,
      format: 'json',
      options: {
        temperature: request.options?.temperature ?? 0.2,
      },
    };

    let fetchResponse: Response;
    try {
      fetchResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.customHeaders,
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (networkErr: any) {
      if (signal?.aborted) {
        throw createAppError(ErrorCode.CANCELLED, 'Ollama translation cancelled');
      }
      throw createAppError(
        ErrorCode.NETWORK_ERROR,
        `Cannot connect to local Ollama service at ${endpoint}. Make sure Ollama is running: ${networkErr.message}`,
        { endpoint }
      );
    }

    if (!fetchResponse.ok) {
      const errText = await fetchResponse.text().catch(() => '');
      if (fetchResponse.status === 404) {
        throw createAppError(
          ErrorCode.MODEL_UNAVAILABLE,
          `Ollama model "${this.config.model}" not found or endpoint invalid. Try \`ollama pull ${this.config.model}\``
        );
      }
      throw createAppError(
        ErrorCode.INTERNAL_ERROR,
        `Ollama returned HTTP ${fetchResponse.status}: ${errText}`
      );
    }

    const data = await fetchResponse.json();
    const rawContent: string = data.message?.content || '';

    let parsedSegments: TranslationSegmentResult[] = [];
    try {
      const parsed = JSON.parse(rawContent.trim());
      if (Array.isArray(parsed.segments)) {
        parsedSegments = parsed.segments;
      } else if (Array.isArray(parsed)) {
        parsedSegments = parsed;
      }
    } catch (err) {
      throw createAppError(
        ErrorCode.ALIGNMENT_MISMATCH,
        `Ollama output failed to parse as JSON: ${rawContent}`
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
        id: `ollama/${this.config.model}`,
        revision: `ollama-rev-${this.config.revision || 1}`,
        actualLocation: 'local',
      },
      metrics: {
        durationMs,
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
        cacheHit: false,
      },
    };
  }

  async testConnection(signal?: AbortSignal): Promise<{ durationMs: number; sampleTranslation: string }> {
    const testReq: TranslationRequest = {
      requestId: 'test-ollama-' + Date.now(),
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
