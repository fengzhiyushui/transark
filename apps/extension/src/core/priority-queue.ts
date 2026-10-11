import type { TranslationUnit } from './dom-walker';
import type { TranslationRequest, TranslationResponse } from '@translate/contracts';

export interface PriorityQueueOptions {
  batchSize?: number;
  concurrency?: number;
  onBatchTranslated?: (response: TranslationResponse, units: TranslationUnit[]) => void;
  onError?: (err: Error, units: TranslationUnit[]) => void;
  onProgress?: (completed: number, total: number) => void;
  translateFn: (request: TranslationRequest, signal?: AbortSignal) => Promise<TranslationResponse>;
}

interface QueuedItem {
  unit: TranslationUnit;
  inViewport: boolean;
  addedAt: number;
}

export class ViewportPriorityQueue {
  private queue: QueuedItem[] = [];
  private processingSet = new Set<string>();
  private completedSet = new Set<string>();
  private intersectionObserver: IntersectionObserver | null = null;
  private abortController: AbortController | null = null;

  private isRunning: boolean = false;
  private activeWorkers: number = 0;
  private totalCount: number = 0;

  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly translateFn: (request: TranslationRequest, signal?: AbortSignal) => Promise<TranslationResponse>;
  private readonly onBatchTranslated?: (response: TranslationResponse, units: TranslationUnit[]) => void;
  private readonly onError?: (err: Error, units: TranslationUnit[]) => void;
  private readonly onProgress?: (completed: number, total: number) => void;

  constructor(options: PriorityQueueOptions) {
    this.batchSize = options.batchSize || 8;
    this.concurrency = options.concurrency || 2;
    this.translateFn = options.translateFn;
    this.onBatchTranslated = options.onBatchTranslated;
    this.onError = options.onError;
    this.onProgress = options.onProgress;

    this.initObserver();
  }

  private initObserver() {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        let needsResort = false;
        for (const entry of entries) {
          const targetEl = entry.target as HTMLElement;
          const targetId = targetEl.getAttribute('data-trans-seg-id');
          if (!targetId) continue;

          const item = this.queue.find((q) => q.unit.id === targetId);
          if (item) {
            const wasInViewport = item.inViewport;
            item.inViewport = entry.isIntersecting;
            if (!wasInViewport && entry.isIntersecting) {
              needsResort = true;
            }
          }
        }

        if (needsResort && this.isRunning) {
          this.sortQueue();
          this.scheduleNext();
        }
      },
      {
        root: null,
        rootMargin: '120px 0px 120px 0px', // 预加载屏外 120px
        threshold: 0.05,
      }
    );
  }

  /**
   * 按可视区域优先、先加入先处理进行稳定排序
   */
  private sortQueue() {
    this.queue.sort((a, b) => {
      // 1. 可视区域内的优先处理
      if (a.inViewport && !b.inViewport) return -1;
      if (!a.inViewport && b.inViewport) return 1;
      // 2. 同在屏内或屏外时，按排队时间先后执行
      return a.addedAt - b.addedAt;
    });
  }

  /**
   * 添加待翻译单元列表
   */
  public enqueue(units: TranslationUnit[]) {
    for (const unit of units) {
      if (
        this.completedSet.has(unit.id) ||
        this.processingSet.has(unit.id) ||
        this.queue.some((q) => q.unit.id === unit.id)
      ) {
        continue;
      }

      // 给 DOM 打上标记便于观察者反查
      unit.element.setAttribute('data-trans-seg-id', unit.id);

      // 观察其可见性
      this.intersectionObserver?.observe(unit.element);

      this.queue.push({
        unit,
        inViewport: false,
        addedAt: Date.now(),
      });
      this.totalCount++;
    }

    this.sortQueue();
  }

  /**
   * 启动调度器
   */
  public start(targetLang: string, sourceLang: string = 'auto') {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();

    this.scheduleNext(targetLang, sourceLang);
  }

  /**
   * 暂停/停止调度器
   */
  public stop() {
    this.isRunning = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * 清理与重置
   */
  public destroy() {
    this.stop();
    this.intersectionObserver?.disconnect();
    this.queue = [];
    this.processingSet.clear();
    this.completedSet.clear();
    this.totalCount = 0;
  }

  private scheduleNext(targetLang: string = 'zh-CN', sourceLang: string = 'auto') {
    if (!this.isRunning || !this.abortController) return;

    while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
      // 取出一批
      const batchItems = this.queue.splice(0, this.batchSize);
      if (batchItems.length === 0) break;

      const batchUnits = batchItems.map((b) => b.unit);
      for (const u of batchUnits) {
        this.processingSet.add(u.id);
      }

      this.activeWorkers++;
      this.dispatchBatch(batchUnits, targetLang, sourceLang);
    }
  }

  private async dispatchBatch(
    units: TranslationUnit[],
    targetLang: string,
    sourceLang: string
  ) {
    const requestId = `req-chunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const request: TranslationRequest = {
      requestId,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      segments: units.map((u) => ({
        id: u.id,
        text: u.text,
      })),
    };

    try {
      const response = await this.translateFn(request, this.abortController?.signal);

      for (const u of units) {
        this.processingSet.delete(u.id);
        this.completedSet.add(u.id);
        this.intersectionObserver?.unobserve(u.element);
      }

      this.onBatchTranslated?.(response, units);
      this.onProgress?.(this.completedSet.size, this.totalCount);
    } catch (err: any) {
      console.error('[PriorityQueue] Batch translation failed:', err);
      for (const u of units) {
        this.processingSet.delete(u.id);
      }
      this.onError?.(err, units);
    } finally {
      this.activeWorkers--;
      if (this.isRunning) {
        this.scheduleNext(targetLang, sourceLang);
      }
    }
  }

  public getStats() {
    return {
      pending: this.queue.length,
      processing: this.processingSet.size,
      completed: this.completedSet.size,
      total: this.totalCount,
    };
  }
}
