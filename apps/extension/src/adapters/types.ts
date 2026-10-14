import type {
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
  TranslationSegmentResult,
} from '@translate/contracts';

/**
 * 逐段增量回调。
 *
 * 流式请求在解析到每个已完成段落时立即回调，用于「首段即回填」，
 * 把用户感知延迟从「整批完成」降到「首段完成」。
 */
export type SegmentCallback = (segment: TranslationSegmentResult) => void;

/**
 * 翻译提供者统一接口驱动
 */
export interface TranslationProvider {
  readonly config: TranslationProviderConfig;

  /**
   * 执行翻译请求。
   *
   * @param request 翻译请求
   * @param signal  取消信号
   * @param onSegment 可选的逐段增量回调；传入时若协议支持流式，
   *                  会在每个段落解析完成后立即触发（同一段落不会重复触发）。
   *                  最终返回的 TranslationResponse 仍包含全部段落，可作为权威结果。
   */
  translate(
    request: TranslationRequest,
    signal?: AbortSignal,
    onSegment?: SegmentCallback
  ): Promise<TranslationResponse>;

  /**
   * 测试服务连通性
   */
  testConnection(signal?: AbortSignal): Promise<{ durationMs: number; sampleTranslation: string }>;
}
