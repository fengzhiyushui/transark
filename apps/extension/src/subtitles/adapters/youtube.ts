import type { SubtitleCue } from '../cues.ts';
import type { SiteSubtitleAdapter } from '../sources.ts';
import { sendMessageToBackground } from '../../messaging/client.ts';

export interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
  name?: string;
}

/**
 * 从页面 HTML 中提取 YouTube 的 captionTracks。
 *
 * YouTube 把 `ytInitialPlayerResponse` 内联在 HTML 里，字幕轨位于
 * `captions.playerCaptionsTracklistRenderer.captionTracks`。这里用括号配对
 * 提取 JSON 数组，避免依赖页面全局变量（Content Script 处于隔离世界）。
 */
export function extractCaptionTracks(html: string): CaptionTrack[] {
  const array = extractJsonArrayAfter(html, 'captionTracks');
  if (!array) return [];
  return array
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl : '',
      languageCode: typeof item.languageCode === 'string' ? item.languageCode : undefined,
      kind: typeof item.kind === 'string' ? item.kind : undefined,
      name:
        typeof item.name === 'object' && item.name && 'simpleText' in item.name
          ? String((item.name as { simpleText?: unknown }).simpleText ?? '')
          : undefined,
    }))
    .filter((track) => Boolean(track.baseUrl));
}

function extractJsonArrayAfter(source: string, key: string): unknown[] | null {
  const marker = `"${key}":`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  let start = source.indexOf('[', markerIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const ch = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(source.slice(start, index + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 优先手动字幕轨，其次自动生成轨。 */
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;
  return tracks.find((track) => track.kind !== 'asr') ?? tracks[0];
}

/** timedtext 默认返回 XML；追加 fmt=json3 可拿到结构化事件。 */
export function buildTimedTextUrl(baseUrl: string): string {
  if (/[?&]fmt=/.test(baseUrl)) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
}

/** 解析 timedtext 的 json3 或 XML 响应。 */
export function parseTimedText(body: string): SubtitleCue[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{')) return parseJson3(trimmed);
  return parseXmlTimedText(trimmed);
}

function parseJson3(body: string): SubtitleCue[] {
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const events: any[] = Array.isArray(data?.events) ? data.events : [];
  const cues: SubtitleCue[] = [];
  for (const event of events) {
    const segments: any[] = Array.isArray(event?.segs) ? event.segs : [];
    const text = segments
      .map((seg) => (typeof seg?.utf8 === 'string' ? seg.utf8 : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const start = Number(event.tStartMs) / 1000;
    const duration = Number(event.dDurationMs) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(duration)) continue;
    cues.push(makeCue(cues.length, start, start + Math.max(0.2, duration), text));
  }
  return cues;
}

function parseXmlTimedText(body: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const regex = /<text\b[^>]*\bstart="([\d.]+)"[^>]*(?:\bdur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const start = Number(match[1]);
    const duration = match[2] ? Number(match[2]) : 2;
    const text = decodeEntities(match[3].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || !Number.isFinite(start)) continue;
    cues.push(makeCue(cues.length, start, start + Math.max(0.2, duration), text));
  }
  return cues;
}

function makeCue(index: number, start: number, end: number, text: string): SubtitleCue {
  return {
    id: `yt-${String(index + 1).padStart(4, '0')}`,
    startTime: Number(start.toFixed(3)),
    endTime: Number(end.toFixed(3)),
    text,
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_all, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export const youtubeAdapter: SiteSubtitleAdapter = {
  id: 'youtube',
  matches(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'youtube.com' || host.endsWith('.youtube.com');
    } catch {
      return false;
    }
  },
  async fetchCues(): Promise<SubtitleCue[] | null> {
    const tracks = extractCaptionTracks(document.documentElement.innerHTML);
    const track = pickCaptionTrack(tracks);
    if (!track) return null;
    const response = await sendMessageToBackground<{ body: string }>({
      type: 'FETCH_SUBTITLE_TRACK',
      payload: { url: buildTimedTextUrl(track.baseUrl) },
    });
    if (!response.success || !response.data?.body) return null;
    const cues = parseTimedText(response.data.body);
    return cues.length > 0 ? cues : null;
  },
};
