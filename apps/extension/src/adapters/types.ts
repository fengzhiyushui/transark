import type {
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
} from '@translate/contracts';

/**
 * 翻译提供者统一接口驱动
 */
export interface TranslationProvider {
  readonly config: TranslationProviderConfig;

  /**
   * 执行翻译请求
   */
  translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResponse>;

  /**
   * 测试服务连通性
   */
  testConnection(signal?: AbortSignal): Promise<{ durationMs: number; sampleTranslation: string }>;
}
