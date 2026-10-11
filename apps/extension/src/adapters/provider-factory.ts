import type { TranslationProviderConfig } from '@translate/contracts';
import type { TranslationProvider } from './types';
import { MockProvider } from './mock-adapter';
import { OpenAIChatAdapter } from './openai-adapter';
import { OllamaAdapter } from './ollama-adapter';

export function createTranslationProvider(
  config: TranslationProviderConfig,
  mockDelayMs: number = 100
): TranslationProvider {
  const protocol = config.protocol;

  switch (protocol) {
    case 'mock' as any:
      return new MockProvider(config, mockDelayMs);

    case 'ollama':
      return new OllamaAdapter(config);

    case 'openai-chat':
    case 'openai-responses':
      return new OpenAIChatAdapter(config);

    case 'custom-translate':
      // 支持自定义 REST 接口，若为测试环境亦可回退兼容
      return new OpenAIChatAdapter(config);

    default:
      console.warn(`[ProviderFactory] Unknown protocol "${protocol}", falling back to MockProvider`);
      return new MockProvider(config, mockDelayMs);
  }
}
