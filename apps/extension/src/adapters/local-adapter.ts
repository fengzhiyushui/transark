import type {
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
} from '@translate/contracts';
import { ErrorCode, createAppError } from '@translate/contracts';
import type { TranslationProvider } from './types.ts';

/**
 * 本地接入占位适配器。
 *
 * 说明：本地接入（本机 / 内网自建推理服务）的底层适配**将在后续版本提供**。
 * 本类存在的意义是保证「接入方式」维度在架构上完整落地，并且**绝不伪装成功**：
 * 任何调用都会明确抛出 `MODEL_UNAVAILABLE`，避免用户误以为本地推理已生效。
 *
 * 后续接入时的实现方向：本机进程直连、伴随服务握手（Bearer 配对令牌）、
 * 本机模型运行时探测等，均只需替换本类的 `translate` / `testConnection`。
 */
const UNSUPPORTED_MESSAGE =
  '本地接入的底层适配尚未提供（当前版本仅支持 API 接入）。' +
  '请在「接入方式」中选择 API 接入，或关注后续版本更新。';

export class LocalAccessAdapter implements TranslationProvider {
  public readonly config: TranslationProviderConfig;

  constructor(config: TranslationProviderConfig) {
    this.config = config;
  }

  async translate(_request: TranslationRequest, _signal?: AbortSignal): Promise<TranslationResponse> {
    throw createAppError(ErrorCode.MODEL_UNAVAILABLE, UNSUPPORTED_MESSAGE, {
      profileId: this.config.profileId,
      accessMode: 'local',
    });
  }

  async testConnection(): Promise<{ durationMs: number; sampleTranslation: string }> {
    throw createAppError(ErrorCode.MODEL_UNAVAILABLE, UNSUPPORTED_MESSAGE, {
      profileId: this.config.profileId,
      accessMode: 'local',
    });
  }
}
