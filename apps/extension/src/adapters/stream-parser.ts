import type { TranslationSegmentResult } from '@translate/contracts';

/**
 * 增量 JSON 段落提取器（流式翻译的核心）。
 *
 * 问题：模型以 SSE 流式返回时，JSON 是逐字符到达的，无法等全部结束再
 * `JSON.parse`——那样就失去了「首段即回填」的意义。
 *
 * 方案：用一个字符级状态机扫描累积缓冲区，维护一个「下一次遇到的 `{`
 * 属于段落对象」的标志。该标志在检测到 `"segments"` 之后的第一个 `[`
 * 时置位；此后每遇到一个顶层 `{...}` 闭合，就局部 `JSON.parse` 交付。
 *
 * 因为段落对象是扁平的（id + translation），一旦遇到配对的 `}` 即可安全
 * 解析，即便最后一个对象仍在传输中，前面的段落也能立刻交付。
 *
 * 已消费的字符会被裁剪，缓冲区不会无限增长。
 */
export class IncrementalSegmentParser {
  private buffer = '';
  private scanned = 0;

  /** 是否已进入（或已结束）segments 数组内部 */
  private insideSegments = false;
  /** 嵌套深度：仅在 depth 从 0 → 1 时记录对象起点 */
  private depth = 0;
  private objectStart = -1;
  /** 字符串状态：避免把字符串内的 {} 当成结构字符 */
  private inString = false;
  private escaped = false;

  private readonly emitted = new Set<string>();

  /** 追加新到达的文本片段，返回本轮新解析出的完整段落 */
  public push(chunk: string): TranslationSegmentResult[] {
    if (chunk) {
      this.buffer += chunk;
    }
    return this.scan();
  }

  /** 已交付的段落 ID（用于最终去重校验） */
  public emittedIds(): string[] {
    return Array.from(this.emitted);
  }

  private scan(): TranslationSegmentResult[] {
    const found: TranslationSegmentResult[] = [];

    while (this.scanned < this.buffer.length) {
      const ch = this.buffer[this.scanned];

      // ---- 字符串内部：只关心转义与闭合引号
      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (ch === '\\') {
          this.escaped = true;
        } else if (ch === '"') {
          this.inString = false;
        }
        this.scanned++;
        continue;
      }

      if (ch === '"') {
        this.inString = true;
        this.scanned++;
        continue;
      }

      // ---- 结构字符
      if (ch === '[') {
        // `"segments"` 之后的第一个 `[` 即数组起点
        if (!this.insideSegments && this.bufferHasSegmentsKeyword(this.scanned)) {
          this.insideSegments = true;
        }
        this.scanned++;
        continue;
      }

      if (ch === '{') {
        if (this.insideSegments && this.depth === 0) {
          this.objectStart = this.scanned;
        }
        if (this.insideSegments) {
          this.depth++;
        }
        this.scanned++;
        continue;
      }

      if (ch === '}') {
        if (this.insideSegments && this.depth > 0) {
          this.depth--;
          if (this.depth === 0 && this.objectStart >= 0) {
            const raw = this.buffer.slice(this.objectStart, this.scanned + 1);
            const parsed = this.tryParseSegment(raw);
            if (parsed && !this.emitted.has(parsed.id)) {
              this.emitted.add(parsed.id);
              found.push(parsed);
            }
            this.objectStart = -1;
          }
        }
        this.scanned++;
        continue;
      }

      if (ch === ']' && this.insideSegments && this.depth === 0) {
        // segments 数组闭合，本批段落结束
        this.insideSegments = false;
        this.scanned++;
        continue;
      }

      this.scanned++;
    }

    this.compact();
    return found;
  }

  /**
   * 检查 `[` 之前是否刚出现过 `"segments"` 关键字。
   * 只回看有限窗口，避免对大缓冲区做全量正则。
   */
  private bufferHasSegmentsKeyword(index: number): boolean {
    const windowStart = Math.max(0, index - 32);
    const prefix = this.buffer.slice(windowStart, index);
    return /"segments"\s*:\s*$/.test(prefix);
  }

  private tryParseSegment(raw: string): TranslationSegmentResult | null {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.id === 'string') {
        return {
          id: obj.id,
          translation: typeof obj.translation === 'string' ? obj.translation : '',
        };
      }
    } catch {
      // 单个对象解析失败：跳过，不影响其余段落交付
    }
    return null;
  }

  /**
   * 裁剪已扫描完的缓冲区前缀，防止长流式请求下内存无限增长。
   *
   * 注意：只有在**已经进入 segments 数组**之后才允许丢弃前缀。
   * 否则逐字符到达时，`"segments":[` 这个定位标记会在数组开始之前
   * 就被裁掉，导致再也识别不出数组起点。
   */
  private compact(): void {
    if (!this.insideSegments && this.objectStart < 0) {
      return;
    }

    const keepFrom = this.objectStart >= 0 ? this.objectStart : this.scanned;
    if (keepFrom > 0) {
      this.buffer = this.buffer.slice(keepFrom);
      this.scanned -= keepFrom;
      if (this.objectStart >= 0) {
        this.objectStart -= keepFrom;
      }
    }
  }
}

/**
 * 从 SSE 数据块中提取 `data:` 负载。
 * 兼容 `data: {...}` 与 `data:{...}`，忽略 `[DONE]` 与注释行。
 */
export function extractSseDataLines(chunk: string): string[] {
  const out: string[] = [];
  for (const line of chunk.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    out.push(payload);
  }
  return out;
}
