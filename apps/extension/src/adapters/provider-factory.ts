import type { TranslationProviderConfig } from '@translate/contracts';
import type { TranslationProvider } from './types';
import { MockProvider } from './mock-adapter';
import { OpenAIChatAdapter } from './openai-adapter';
import { OllamaAdapter } from './ollama-adapter';
import { AnthropicAdapter } from './anthropic-adapter';
import { ChromeBuiltinAdapter } from './chrome-builtin-adapter';

export function createTranslationProvider(
  config: TranslationProviderConfig,
  mockDelayMs: number = 100
): TranslationProvider {
  const protocol = config.protocol;

  switch (protocol) {
    case 'mock' as any:
      return new MockProvider(config, mockDelayMs);

    case 'chrome-builtin':
      return new ChromeBuiltinAdapter(config);

    case 'anthropic-messages':
      return new AnthropicAdapter(config);

    case 'openai-chat':
    case 'openai-responses':
      return new OpenAIChatAdapter(config);

    case 'ollama':
      return new OllamaAdapter(config);

    case 'custom-translate':
      return new OpenAIChatAdapter(config);

    default:
      console.warn(`[ProviderFactory] Unknown protocol "${protocol}", falling back to MockProvider`);
      return new MockProvider(config, mockDelayMs);
  }
}
