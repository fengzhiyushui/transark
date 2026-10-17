import { parseSubtitleText, sortCues, type SubtitleCue } from './cues.ts';
import { youtubeAdapter } from './adapters/youtube.ts';

interface VideoWithTracks {
  textTracks?: TextTrackList | null;
}

/**
 * 从 `<video>` 的内嵌字幕轨道提取 cue。
 * 跨域轨道读取 `track.cues` 会被浏览器置空，此时返回空数组，
 * 由调用方回退到站点接口或 ASR。
 */
export function extractEmbeddedCues(video: VideoWithTracks): SubtitleCue[] {
  const tracks = video.textTracks;
  if (!tracks) return [];
  const cues: SubtitleCue[] = [];

  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const track = tracks[trackIndex];
    if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
    const list = track.cues;
    if (!list) continue;
    for (let cueIndex = 0; cueIndex < list.length; cueIndex++) {
      const cue = list[cueIndex] as VTTCue | undefined;
      if (!cue || typeof cue.text !== 'string') continue;
      const text = cue.text
        .replace(/<[^>]+>/g, '')
        .replace(/\{\\[^}]+\}/g, '')
        .trim();
      if (!text) continue;
      cues.push({
        id: `track-${trackIndex}-${cueIndex}`,
        startTime: cue.startTime,
        endTime: cue.endTime,
        text,
      });
    }
  }
  return sortCues(cues);
}

/** 解析用户上传的 .srt / .vtt 文件。 */
export async function parseSubtitleFile(file: File): Promise<SubtitleCue[]> {
  return parseSubtitleText(await file.text());
}

/**
 * 站点字幕适配器：不同站点（YouTube / Bilibili 等）的字幕获取方式不同，
 * 通过该接口按域名注册，失败时返回 null 让管道回退到 ASR。
 */
export interface SiteSubtitleAdapter {
  id: string;
  matches(url: string): boolean;
  fetchCues(video: HTMLVideoElement): Promise<SubtitleCue[] | null>;
}

const adapters: SiteSubtitleAdapter[] = [];

export function registerSiteSubtitleAdapter(adapter: SiteSubtitleAdapter): void {
  adapters.push(adapter);
}

export function listSiteSubtitleAdapters(): string[] {
  return adapters.map((adapter) => adapter.id);
}

export async function fetchSiteCues(
  url: string,
  video: HTMLVideoElement
): Promise<SubtitleCue[]> {
  for (const adapter of adapters) {
    if (!adapter.matches(url)) continue;
    try {
      const cues = await adapter.fetchCues(video);
      if (cues && cues.length > 0) return sortCues(cues);
    } catch (err) {
      console.warn(`[Subtitles] 站点适配器 ${adapter.id} 获取失败`, err);
    }
  }
  return [];
}

/** 选取页面中面积最大的可见 `<video>` 作为字幕挂载目标。 */
export function findPrimaryVideo(root: ParentNode = document): HTMLVideoElement | null {
  const videos = Array.from(root.querySelectorAll('video'));
  let best: HTMLVideoElement | null = null;
  let bestArea = -1;
  for (const video of videos) {
    const area =
      Math.max(1, video.clientWidth || video.videoWidth || 0) *
      Math.max(1, video.clientHeight || video.videoHeight || 0);
    if (area > bestArea) {
      best = video;
      bestArea = area;
    }
  }
  return best;
}

// 站点适配器注册（按需扩展：Bilibili、Vimeo 等）
registerSiteSubtitleAdapter(youtubeAdapter);
