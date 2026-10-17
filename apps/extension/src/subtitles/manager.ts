import { applyTranslation, sortCues, type SubtitleCue } from './cues.ts';
import { BilingualSubtitleOverlay, type VideoLike } from './overlay.ts';
import { extractEmbeddedCues, fetchSiteCues } from './sources.ts';

export type SubtitleSource = 'embedded' | 'site' | 'upload' | 'asr' | null;

export interface SubtitleRuntimeStatus {
  active: boolean;
  source: SubtitleSource;
  cueCount: number;
  translatedCount: number;
  error?: string;
}

export interface SubtitleManagerHooks {
  /** 把一批 cue 交给 Background 走云端流式翻译（译文通过 onTranslatedCue 回填） */
  translateCues(requestId: string, cues: SubtitleCue[], targetLanguage: string): Promise<void>;
  startAsr(targetLanguage: string): Promise<void>;
  stopAsr(): void;
}

/**
 * 单页面字幕编排器：
 *  1. 优先内嵌轨道 → 2. 站点适配器 → 3. 都没有则启动云端流式 ASR。
 * 原文立即渲染，译文到达后逐条回填。
 */
export class SubtitleManager {
  private readonly hooks: SubtitleManagerHooks;
  private video: HTMLVideoElement | null = null;
  private overlay: BilingualSubtitleOverlay | null = null;
  private cues: SubtitleCue[] = [];
  private source: SubtitleSource = null;
  private active = false;
  private targetLanguage = 'zh-CN';
  private error: string | undefined;
  /** ASR cue 是“从捕获开始计时”的相对时间，需加上开启时的视频进度 */
  private asrBaseTime = 0;

  constructor(hooks: SubtitleManagerHooks) {
    this.hooks = hooks;
  }

  async start(video: HTMLVideoElement, targetLanguage: string): Promise<SubtitleRuntimeStatus> {
    this.begin(video, targetLanguage);

    let cues = extractEmbeddedCues(video);
    let source: SubtitleSource = cues.length > 0 ? 'embedded' : null;

    if (cues.length === 0) {
      cues = await fetchSiteCues(location.href, video);
      source = cues.length > 0 ? 'site' : null;
    }

    if (cues.length > 0) {
      await this.applyCues(cues, source, targetLanguage);
    } else {
      // 无字幕：进入 ASR 模式，cue 由 Background 通过 ASR_EVENT 持续推进来
      this.source = 'asr';
      this.cues = [];
      this.asrBaseTime = video.currentTime || 0;
      this.overlay?.setCues([]);
      try {
        await this.hooks.startAsr(targetLanguage);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      }
    }

    return this.getStatus();
  }

  /** 上传 SRT/VTT：跳过来源探测，直接使用用户提供的 cue。 */
  async loadExternalCues(
    video: HTMLVideoElement,
    cues: SubtitleCue[],
    targetLanguage: string
  ): Promise<SubtitleRuntimeStatus> {
    this.begin(video, targetLanguage);
    await this.applyCues(cues, 'upload', targetLanguage);
    return this.getStatus();
  }

  private begin(video: HTMLVideoElement, targetLanguage: string): void {
    this.stop();
    this.video = video;
    this.targetLanguage = targetLanguage;
    this.error = undefined;
    this.active = true;

    this.overlay = new BilingualSubtitleOverlay(video as unknown as VideoLike, {
      bottomPercent: 10,
    });
    this.overlay.attach();
    this.overlay.start();
  }

  private async applyCues(
    cues: SubtitleCue[],
    source: SubtitleSource,
    targetLanguage: string
  ): Promise<void> {
    this.source = source;
    this.cues = sortCues(cues);
    this.overlay?.setCues(this.cues);
    try {
      await this.hooks.translateCues(
        `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        this.cues,
        targetLanguage
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** 云端 ASR 新识别出的 cue（相对时间 → 视频绝对时间后上屏）。 */
  handleAsrCue(cue: SubtitleCue): void {
    if (!this.active || !this.overlay) return;
    const shifted: SubtitleCue = {
      ...cue,
      startTime: cue.startTime + this.asrBaseTime,
      endTime: cue.endTime + this.asrBaseTime,
    };
    const without = this.cues.filter((item) => item.id !== shifted.id);
    this.cues = sortCues([...without, shifted]);
    this.overlay.setCues(this.cues);
  }

  /** 译文回填（内嵌字幕与 ASR 共用）。 */
  handleTranslatedCue(cueId: string, translation: string): void {
    if (!this.active) return;
    this.cues = applyTranslation(this.cues, cueId, translation);
    this.overlay?.setTranslation(cueId, translation);
  }

  handleError(message: string): void {
    this.error = message;
  }

  stop(): void {
    if (this.source === 'asr') this.hooks.stopAsr();
    this.overlay?.destroy();
    this.overlay = null;
    this.video = null;
    this.cues = [];
    this.source = null;
    this.active = false;
    this.error = undefined;
    this.asrBaseTime = 0;
  }

  getStatus(): SubtitleRuntimeStatus {
    return {
      active: this.active,
      source: this.source,
      cueCount: this.cues.length,
      translatedCount: this.cues.filter((cue) => Boolean(cue.translation)).length,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  getTargetLanguage(): string {
    return this.targetLanguage;
  }
}
