import type { TranslationUnit } from './dom-walker.ts';
import type {
  TranslationRequest,
  TranslationResponse,
  TranslationSegmentResult,
} from '@translate/contracts';

export interface PriorityQueueOptions {
  batchSize?: number;
  concurrency?: number;
  /** 失败重试次数（不含首次），默认 2 */
  maxRetries?: number;
  /** 重试基础退避毫秒（指数退避），默认 400 */
  retryBaseDelayMs?: number;
  onBatchTranslated?: (response: TranslationResponse, units: TranslationUnit[]) => void;
  /** 单段增量回填（流式时逐段触发） */
  onSegmentTranslated?: (unit: TranslationUnit, segment: TranslationSegmentResult) => void;
  onError?: (err: Error, units: TranslationUnit[]) => void;
  onProgress?: (completed: number, total: number) => void;
  translateFn: (
    request: TranslationRequest,
    signal?: AbortSignal,
    onSegment?: (segment: TranslationSegmentResult) => void
  ) => Promise<TranslationResponse>;
}

interface QueuedItem {
  unit: TranslationUnit;
  inViewport: boolean;
  addedAt: number;
  attempts: number;
}

/** 单段最大字符数：过长的段落单独成批，避免拖慢整批 */
const LARGE_SEGMENT_CHARS = 1200;

export class ViewportPriorityQueue {
  private queue: QueuedItem[] = [];
  /** id → 队列项，避免在 observer 回调中做线性查找 */
  private index = new Map<string, QueuedItem>();
  private processingSet = new Set<string>();
  private completedSet = new Set<string>();
  private intersectionObserver: IntersectionObserver | null = null;
  private abortController: AbortController | null = null;

  private isRunning: boolean = false;
  private activeWorkers: number = 0;
  private totalCount: number = 0;

  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly translateFn: PriorityQueueOptions['translateFn'];
  private readonly onBatchTranslated?: PriorityQueueOptions['onBatchTranslated'];
  private readonly onSegmentTranslated?: PriorityQueueOptions['onSegmentTranslated'];
  private readonly onError?: PriorityQueueOptions['onError'];
  private readonly onProgress?: PriorityQueueOptions['onProgress'];

  constructor(options: PriorityQueueOptions) {
    // 批大小与并发度：批越大，请求数越少、RPM 压力越低；
    // 并发度受上游配额约束，不宜盲目提高。
    this.batchSize = options.batchSize || 8;
    this.concurrency = options.concurrency || 2;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 400;
    this.translateFn = options.translateFn;
    this.onBatchTranslated = options.onBatchTranslated;
    this.onSegmentTranslated = options.onSegmentTranslated;
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

          // Map 索引查找，避免 O(n) 线性扫描
          const item = this.index.get(targetId);
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
    let added = false;

    for (const unit of units) {
      if (
        this.completedSet.has(unit.id) ||
        this.processingSet.has(unit.id) ||
        this.index.has(unit.id)
      ) {
        continue;
      }

      // 给 DOM 打上标记便于观察者反查
      unit.element.setAttribute('data-trans-seg-id', unit.id);

      // 观察其可见性
      this.intersectionObserver?.observe(unit.element);

      const item: QueuedItem = {
        unit,
        inViewport: false,
        addedAt: Date.now(),
        attempts: 0,
      };
      this.queue.push(item);
      this.index.set(unit.id, item);
      this.totalCount++;
      added = true;
    }

    if (added) this.sortQueue();
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
    this.index.clear();
    this.processingSet.clear();
    this.completedSet.clear();
    this.totalCount = 0;
  }

  /**
   * 取出一批待处理项。
   *
   * 若队首是超长段落，则只取这一条单独成批——避免一个长段落
   * 拖慢整批中其他短段落的返回。
   */
  private takeBatch(): QueuedItem[] {
    if (this.queue.length === 0) return [];

    const first = this.queue[0];
    if (first.unit.text.length >= LARGE_SEGMENT_CHARS) {
      this.queue.shift();
      this.index.delete(first.unit.id);
      return [first];
    }

    const batch = this.queue.splice(0, this.batchSize);
    for (const item of batch) {
      this.index.delete(item.unit.id);
    }
    return batch;
  }

  private scheduleNext(targetLang: string = 'zh-CN', sourceLang: string = 'auto') {
    if (!this.isRunning || !this.abortController) return;

    while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
      const batchItems = this.takeBatch();
      if (batchItems.length === 0) break;

      for (const item of batchItems) {
        this.processingSet.add(item.unit.id);
      }

      this.activeWorkers++;
      this.dispatchBatch(batchItems, targetLang, sourceLang);
    }
  }

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        },
        { once: true }
      );
    });
  }

  private async dispatchBatch(
    batchItems: QueuedItem[],
    targetLang: string,
    sourceLang: string
  ) {
    const units = batchItems.map((b) => b.unit);
    const requestId = `req-chunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const request: TranslationRequest = {
      requestId,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      segments: units.map((u) => ({ id: u.id, text: u.text })),
    };

    // 流式增量回填：只对属于本批的段落回调，且每段仅回填一次
    const unitById = new Map(units.map((u) => [u.id, u]));
    const filled = new Set<string>();
    const onSegment = this.onSegmentTranslated
      ? (segment: TranslationSegmentResult) => {
          const unit = unitById.get(segment.id);
          if (!unit || filled.has(segment.id)) return;
          filled.add(segment.id);
          this.onSegmentTranslated?.(unit, segment);
        }
      : undefined;

    try {
      const response = await this.translateFn(request, this.abortController?.signal, onSegment);

      for (const item of batchItems) {
        this.processingSet.delete(item.unit.id);
        this.completedSet.add(item.unit.id);
        this.intersectionObserver?.unobserve(item.unit.element);
      }

      // 对未通过流式回填的段落统一补齐（含错误段）
      const respMap = new Map(response.segments.map((s) => [s.id, s]));
      const remaining = units.filter((u) => !filled.has(u.id));
      if (remaining.length > 0) {
        this.onBatchTranslated?.(
          { ...response, segments: response.segments.filter((s) => respMap.has(s.id) && !filled.has(s.id)) },
          remaining
        );
      }

      this.onProgress?.(this.completedSet.size, this.totalCount);
    } catch (err: any) {
      const isAbort = this.abortController?.signal.aborted;

      // 协作式重试：指数退避，仅对未取消的失败生效
      const retryable = batchItems.filter((item) => item.attempts < this.maxRetries);
      if (!isAbort && retryable.length > 0) {
        for (const item of retryable) {
          item.attempts++;
          this.processingSet.delete(item.unit.id);
          this.queue.push(item);
          this.index.set(item.unit.id, item);
        }
        this.sortQueue();

        const backoff = this.retryBaseDelayMs * Math.pow(2, retryable[0].attempts - 1);
        console.warn(
          `[PriorityQueue] 批次失败，${backoff}ms 后重试 ${retryable.length} 段（第 ${retryable[0].attempts} 次）:`,
          err?.message || err
        );
        try {
          await this.delay(backoff, this.abortController?.signal);
        } catch {
          // 退避期间被取消
        }
      } else {
        console.error('[PriorityQueue] Batch translation failed:', err);
        for (const item of batchItems) {
          this.processingSet.delete(item.unit.id);
        }
        this.onError?.(err instanceof Error ? err : new Error(String(err)), units);
      }
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
