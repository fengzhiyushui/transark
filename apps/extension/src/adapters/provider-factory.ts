import type { TranslationProviderConfig } from '@translate/contracts';
import { ErrorCode, createAppError } from '@translate/contracts';
import type { TranslationProvider } from './types.ts';
import { LocalAccessAdapter } from './local-adapter.ts';
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
 * 按「接入方式 + 协议」创建翻译提供者。
 *
 * - accessMode === 'local' → 本地接入（当前为占位实现，明确报不支持）
 * - accessMode === 'api'   → 按 protocol 分派到对应厂商协议适配器
 *
 * 不再静默回退到任何模拟实现：配置错误会明确抛错，避免用户误判翻译来源。
 */
export function createTranslationProvider(config: TranslationProviderConfig): TranslationProvider {
  if (config.accessMode === 'local') {
    return new LocalAccessAdapter(config);
  }

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
