import type { TranslationProviderConfig } from '@translate/contracts';
import { ErrorCode, createAppError } from '@translate/contracts';
import type { TranslationProvider } from './types.ts';
import { OpenAIChatAdapter } from './openai-adapter.ts';
import { AnthropicAdapter } from './anthropic-adapter.ts';
import { GeminiAdapter } from './gemini-adapter.ts';

/** API 接入支持的协议集合 */
export const API_PROTOCOLS = [
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
  'gemini-generate',
] as const;

/**
 * 按协议创建翻译提供者。
 *
 * 项目仅保留 API 接入：配置错误会明确抛错，避免用户误判翻译来源。
 */
export function createTranslationProvider(config: TranslationProviderConfig): TranslationProvider {
  switch (config.protocol) {
    case 'openai-chat':
    case 'openai-responses':
      return new OpenAIChatAdapter(config);

    case 'anthropic-messages':
      return new AnthropicAdapter(config);

    case 'gemini-generate':
      return new GeminiAdapter(config);

    default:
      throw createAppError(
        ErrorCode.UNSUPPORTED_PROTOCOL,
        `不支持的 API 协议: ${String(config.protocol)}（支持: ${API_PROTOCOLS.join(', ')}）`,
        { profileId: config.profileId, protocol: config.protocol }
      );
  }
}
