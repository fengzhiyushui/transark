import { findActiveCue, sortCues, type SubtitleCue } from './cues.ts';

/** 渲染层只需要视频的最小接口，便于在 happy-dom 中测试。 */
export interface VideoLike {
  currentTime: number;
  parentElement: HTMLElement | null;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface OverlayOptions {
  /** 字幕距视频底部的百分比，默认 10% */
  bottomPercent?: number;
  /** 原文轨道字号（px），默认 15 */
  originalFontSize?: number;
  /** 译文轨道字号（px），默认 19 */
  translationFontSize?: number;
}

/**
 * 双语字幕悬浮层。
 *
 * - 使用 Shadow DOM 隔离宿主页面样式（不支持时退化为普通节点）；
 * - 只使用 textContent 写入，杜绝字幕文本导致的 DOM XSS；
 * - 原文常显，译文到达后追加；仅当活跃 cue 或译文变化时才重写 DOM。
 */
export class BilingualSubtitleOverlay {
  private readonly video: VideoLike;
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot | HTMLElement;
  private readonly originalEl: HTMLElement;
  private readonly translationEl: HTMLElement;
  private readonly bottomPercent: number;
  private readonly originalFontSize: number;
  private readonly translationFontSize: number;

  private cues: SubtitleCue[] = [];
  private activeId: string | null = null;
  private activeTranslation: string | null = null;
  private running = false;
  private readonly onTime = () => this.render();

  constructor(
    video: VideoLike,
    options: OverlayOptions = {}
  ) {
    this.video = video;
    this.bottomPercent = options.bottomPercent ?? 10;
    this.originalFontSize = options.originalFontSize ?? 15;
    this.translationFontSize = options.translationFontSize ?? 19;

    this.host = document.createElement('div');
    this.host.className = 'transark-subtitle-overlay';
    this.host.setAttribute('data-transark-subtitle', 'true');
    Object.assign(this.host.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: `${this.bottomPercent}%`,
      display: 'none',
      justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: '2147483647',
      padding: '0 6%',
      textAlign: 'center',
    } satisfies Partial<CSSStyleDeclaration>);

    const shadow = this.host.attachShadow?.({ mode: 'open' });
    this.root = shadow ?? this.host;

    const style = document.createElement('style');
    style.textContent = `
      .wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .line { max-width: 100%; padding: 4px 10px; border-radius: 6px;
              background: rgba(0, 0, 0, 0.62); color: #fff;
              font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
              line-height: 1.35; text-shadow: 0 1px 2px rgba(0,0,0,.85);
              white-space: pre-wrap; word-break: break-word; }
      .orig { opacity: 0.82; }
      .trans { color: #ffe08a; font-weight: 500; }
    `;
    this.originalEl = document.createElement('div');
    this.originalEl.className = 'line orig';
    this.originalEl.style.fontSize = `${this.originalFontSize}px`;
    this.translationEl = document.createElement('div');
    this.translationEl.className = 'line trans';
    this.translationEl.style.fontSize = `${this.translationFontSize}px`;
    this.translationEl.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.append(this.originalEl, this.translationEl);
    this.root.append(style, wrap);
  }

  /** 挂载到视频父容器；父容器为 static 时临时改为 relative。 */
  attach(): void {
    const parent = this.video.parentElement;
    if (!parent) return;
    if (window.getComputedStyle) {
      const position = window.getComputedStyle(parent).position;
      if (!position || position === 'static') {
        parent.style.position = 'relative';
      }
    }
    parent.appendChild(this.host);
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = sortCues(cues);
    this.activeId = null;
    this.activeTranslation = null;
    this.render();
  }

  setTranslation(cueId: string, translation: string): void {
    const target = this.cues.find((cue) => cue.id === cueId);
    if (!target) return;
    target.translation = translation;
    if (this.activeId === cueId) this.render();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.video.addEventListener('timeupdate', this.onTime);
    this.video.addEventListener('seeked', this.onTime);
    this.render();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.video.removeEventListener('timeupdate', this.onTime);
    this.video.removeEventListener('seeked', this.onTime);
  }

  destroy(): void {
    this.stop();
    this.host.remove();
  }

  private render(): void {
    const cue = findActiveCue(this.cues, this.video.currentTime);
    if (!cue) {
      this.host.style.display = 'none';
      this.activeId = null;
      this.activeTranslation = null;
      return;
    }
    const translation = cue.translation ?? null;
    if (this.activeId === cue.id && this.activeTranslation === translation) {
      this.host.style.display = 'flex';
      return;
    }
    this.activeId = cue.id;
    this.activeTranslation = translation;
    this.host.style.display = 'flex';
    this.originalEl.textContent = cue.text;
    if (translation) {
      this.translationEl.textContent = translation;
      this.translationEl.style.display = 'block';
    } else {
      this.translationEl.textContent = '';
      this.translationEl.style.display = 'none';
    }
  }
}
