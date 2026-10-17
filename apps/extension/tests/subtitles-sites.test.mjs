import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GlobalWindow } from 'happy-dom';
import {
  buildTimedTextUrl,
  extractCaptionTracks,
  parseTimedText,
  pickCaptionTrack,
  youtubeAdapter,
} from '../src/subtitles/adapters/youtube.ts';
import { SubtitleManager } from '../src/subtitles/manager.ts';

let window;
let document;

beforeEach(() => {
  window = new GlobalWindow();
  document = window.document;
  globalThis.window = window;
  globalThis.document = document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Event = window.Event;
});

const YOUTUBE_HTML = `<html><body><script>
var ytInitialPlayerResponse = {
  "captions": { "playerCaptionsTracklistRenderer": { "captionTracks": [
    { "baseUrl": "https://www.youtube.com/api/timedtext?v=abc\\u0026lang=en",
      "name": { "simpleText": "English" }, "languageCode": "en" },
    { "baseUrl": "https://www.youtube.com/api/timedtext?v=abc\\u0026lang=en\\u0026kind=asr",
      "kind": "asr", "languageCode": "en" }
  ] } }
};
</script></body></html>`;

describe('YouTube 站点字幕适配器', () => {
  test('从内联 playerResponse 提取 captionTracks', () => {
    const tracks = extractCaptionTracks(YOUTUBE_HTML);
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].languageCode, 'en');
    assert.equal(tracks[1].kind, 'asr');
  });

  test('优先选择手动字幕轨', () => {
    const tracks = extractCaptionTracks(YOUTUBE_HTML);
    const picked = pickCaptionTrack(tracks);
    assert.ok(picked);
    assert.equal(picked.kind, undefined);
  });

  test('追加 fmt=json3，避免重复参数', () => {
    assert.equal(
      buildTimedTextUrl('https://www.youtube.com/api/timedtext?v=1&lang=en'),
      'https://www.youtube.com/api/timedtext?v=1&lang=en&fmt=json3'
    );
    assert.equal(
      buildTimedTextUrl('https://www.youtube.com/api/timedtext?v=1&fmt=srv3'),
      'https://www.youtube.com/api/timedtext?v=1&fmt=srv3'
    );
  });

  test('解析 json3 事件为 cue', () => {
    const cues = parseTimedText(
      JSON.stringify({
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 2000,
            segs: [{ utf8: 'Hello ' }, { utf8: 'world' }],
          },
          { tStartMs: 4000, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
        ],
      })
    );
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Hello world');
    assert.equal(cues[0].startTime, 1);
    assert.equal(cues[0].endTime, 3);
  });

  test('解析 XML timedtext 并解码实体', () => {
    const cues = parseTimedText(
      '<transcript><text start="1.5" dur="2">Hello &amp; world</text>' +
        '<text start="5" dur="1.2">Second</text></transcript>'
    );
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, 'Hello & world');
    assert.equal(cues[1].startTime, 5);
  });

  test('域名匹配只接受 youtube.com 子域', () => {
    assert.equal(youtubeAdapter.matches('https://www.youtube.com/watch?v=1'), true);
    assert.equal(youtubeAdapter.matches('https://youtube.com/watch?v=1'), true);
    assert.equal(youtubeAdapter.matches('https://notyoutube.com/watch?v=1'), false);
    assert.equal(youtubeAdapter.matches('not-a-url'), false);
  });
});

describe('字幕上传管线', () => {
  test('loadExternalCues 接管 cue 并可回填译文', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const video = new window.EventTarget();
    video.currentTime = 0;
    video.parentElement = parent;

    let translatedRequest = null;
    const manager = new SubtitleManager({
      translateCues: async (_requestId, cues, target) => {
        translatedRequest = { cues, target };
      },
      startAsr: async () => {},
      stopAsr: () => {},
    });

    const status = await manager.loadExternalCues(
      video,
      [{ id: 'cue-1', startTime: 1, endTime: 3, text: 'Hello' }],
      'zh-CN'
    );
    assert.equal(status.source, 'upload');
    assert.equal(status.cueCount, 1);
    assert.equal(translatedRequest.cues.length, 1);
    assert.equal(translatedRequest.target, 'zh-CN');

    manager.handleTranslatedCue('cue-1', '你好');
    assert.equal(manager.getStatus().translatedCount, 1);

    manager.stop();
    assert.equal(manager.getStatus().active, false);
  });
});
