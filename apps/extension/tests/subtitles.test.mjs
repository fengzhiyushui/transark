import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GlobalWindow } from 'happy-dom';
import {
  parseSubtitleText,
  findActiveCue,
  sortCues,
  applyTranslation,
} from '../src/subtitles/cues.ts';
import { BilingualSubtitleOverlay } from '../src/subtitles/overlay.ts';
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
  globalThis.location = window.location;
});

describe('字幕 cue 解析与索引', () => {
  test('解析 SRT：时间轴、序号、多行文本', () => {
    const cues = parseSubtitleText(
      '1\n00:00:01,000 --> 00:00:03,500\nHello world.\n\n' +
        '2\n00:00:04,000 --> 00:00:06,200\nSecond line.\n'
    );
    assert.equal(cues.length, 2);
    assert.equal(cues[0].startTime, 1);
    assert.equal(cues[0].endTime, 3.5);
    assert.equal(cues[1].text, 'Second line.');
  });

  test('解析 VTT：WEBVTT 头、NOTE、样式标签', () => {
    const cues = parseSubtitleText(
      'WEBVTT\n\nNOTE this is a comment\n\n' +
        '00:00:00.500 --> 00:00:02.000 align:start\n<v Speaker>Hello</v> <b>there</b>\n'
    );
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Hello there');
    assert.equal(cues[0].startTime, 0.5);
  });

  test('解析 VTT 短时间格式（MM:SS.mmm，无小时段）', () => {
    const cues = parseSubtitleText('WEBVTT\n\n00:01.000 --> 00:03.500\nShort form\n');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].startTime, 1);
    assert.equal(cues[0].endTime, 3.5);
  });

  test('二分查找活跃 cue，并带 80ms 容差', () => {
    const cues = sortCues(parseSubtitleText('00:00:01,000 --> 00:00:02,000\nA\n'));
    assert.equal(findActiveCue(cues, 1.5)?.text, 'A');
    assert.equal(findActiveCue(cues, 0.95)?.text, 'A');
    assert.equal(findActiveCue(cues, 2.5), null);
  });

  test('合并译文返回新数组，不修改原对象', () => {
    const cues = parseSubtitleText('00:00:01,000 --> 00:00:02,000\nA\n');
    const merged = applyTranslation(cues, cues[0].id, '甲');
    assert.equal(merged[0].translation, '甲');
    assert.equal(cues[0].translation, undefined);
  });
});

function makeFakeVideo(parent) {
  const video = new window.EventTarget();
  video.currentTime = 0;
  video.parentElement = parent;
  return video;
}

describe('双语字幕悬浮层', () => {
  test('随 currentTime 切换原文/译文，并只使用 textContent', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const video = makeFakeVideo(parent);
    const overlay = new BilingualSubtitleOverlay(video, { bottomPercent: 8 });
    overlay.attach();
    overlay.setCues([
      { id: 'c1', startTime: 1, endTime: 3, text: '<img src=x onerror=alert(1)>' },
    ]);
    overlay.start();

    const host = parent.querySelector('[data-transark-subtitle]');
    assert.ok(host);
    const root = host.shadowRoot || host;
    const original = root.querySelector('.orig');
    const translated = root.querySelector('.trans');

    video.currentTime = 1.5;
    video.dispatchEvent(new window.Event('timeupdate'));
    assert.equal(host.style.display, 'flex');
    assert.equal(original.textContent, '<img src=x onerror=alert(1)>');
    assert.equal(original.innerHTML.includes('<img'), false);
    assert.equal(translated.style.display, 'none');

    overlay.setTranslation('c1', '译文');
    video.dispatchEvent(new window.Event('timeupdate'));
    assert.equal(translated.textContent, '译文');
    assert.notEqual(translated.style.display, 'none');

    video.currentTime = 5;
    video.dispatchEvent(new window.Event('timeupdate'));
    assert.equal(host.style.display, 'none');

    overlay.destroy();
    assert.equal(parent.querySelector('[data-transark-subtitle]'), null);
  });

  test('ASR cue 会按开启时的视频进度做时间偏移', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const video = makeFakeVideo(parent);
    video.currentTime = 10;

    let asrStarted = false;
    const manager = new SubtitleManager({
      translateCues: async () => {},
      startAsr: async () => {
        asrStarted = true;
      },
      stopAsr: () => {},
    });

    await manager.start(video, 'zh-CN');
    assert.equal(asrStarted, true);
    assert.equal(manager.getStatus().source, 'asr');

    // 服务端返回相对时间 1~2s，应映射到视频的 11~12s
    manager.handleAsrCue({ id: 'asr-1', startTime: 1, endTime: 2, text: 'Hello' });
    video.currentTime = 11.5;
    video.dispatchEvent(new window.Event('timeupdate'));

    const host = parent.querySelector('[data-transark-subtitle]');
    const root = host.shadowRoot || host;
    assert.equal(root.querySelector('.orig').textContent, 'Hello');

    manager.stop();
  });
});
