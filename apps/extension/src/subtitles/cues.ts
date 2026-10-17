import type { AsrCue, TranslationSegment } from '@translate/contracts';

/**
 * 字幕 cue：在契约 AsrCue 基础上增加译文。
 * 时间单位为秒，与视频 currentTime 一致。
 */
export interface SubtitleCue extends AsrCue {
  translation?: string;
}

const TIMING_RE =
  /(?<start>(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(?<end>(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3})/;

function parseTimestamp(value: string): number {
  const parts = value.split(':');
  const [hours, minutes, rest] =
    parts.length === 3 ? parts : ['0', parts[0], parts[1] ?? '0'];
  const [seconds, fraction = '0'] = rest.replace(',', '.').split('.');
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number((fraction + '000').slice(0, 3)) / 1000
  );
}

function stripTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .trim();
}

/**
 * 解析 SRT / VTT 文本为有序 cue 列表。
 * 容忍：BOM、WEBVTT 头、NOTE/STYLE 块、SRT 序号、CRLF、缺失空行。
 */
export function parseSubtitleText(raw: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  let buffer: string[] = [];
  let timing: [number, number] | null = null;

  const flush = () => {
    if (timing === null) {
      buffer = [];
      return;
    }
    const text = stripTags(buffer.join('\n'));
    buffer = [];
    if (!text) {
      timing = null;
      return;
    }
    const index = cues.length + 1;
    cues.push({
      id: `cue-${String(index).padStart(4, '0')}`,
      startTime: timing[0],
      endTime: timing[1],
      text,
    });
    timing = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^WEBVTT/i.test(line) || /^NOTE\b/.test(line) || /^STYLE\b/.test(line)) {
      continue;
    }
    const match = TIMING_RE.exec(line);
    if (match?.groups) {
      flush();
      timing = [parseTimestamp(match.groups.start), parseTimestamp(match.groups.end)];
      continue;
    }
    if (/^\d+$/.test(line) && timing === null) {
      continue;
    }
    if (timing !== null) {
      buffer.push(line);
    }
  }
  flush();
  return cues.filter((cue) => cue.endTime > cue.startTime);
}

/** 按开始时间排序（不修改入参）。 */
export function sortCues(cues: SubtitleCue[]): SubtitleCue[] {
  return [...cues].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
}

/**
 * 二分查找当前时刻活跃的 cue。
 * 允许 80ms 容差，避免 timeupdate 的采样抖动导致字幕闪烁。
 */
export function findActiveCue(cues: SubtitleCue[], time: number): SubtitleCue | null {
  if (cues.length === 0) return null;
  const at = time + 0.08;
  let low = 0;
  let high = cues.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].startTime <= at) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (candidate < 0) return null;
  const cue = cues[candidate];
  return at <= cue.endTime ? cue : null;
}

/** 转为翻译请求的 segments（id 与 cue 一一对应，供严格对齐校验）。 */
export function cuesToSegments(cues: SubtitleCue[]): TranslationSegment[] {
  return cues.map((cue) => ({ id: cue.id, text: cue.text }));
}

/** 合并单条译文，返回新数组（便于 React/渲染层感知变更）。 */
export function applyTranslation(
  cues: SubtitleCue[],
  cueId: string,
  translation: string
): SubtitleCue[] {
  return cues.map((cue) => (cue.id === cueId ? { ...cue, translation } : cue));
}
