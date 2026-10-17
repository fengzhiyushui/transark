import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CloudApiError,
  extractSubtitlesCloud,
  isCloudConfigured,
  translateCuesCloud,
} from '../src/cloud/client.ts';

const CONFIG = {
  endpoint: 'https://cloud.example.com/',
  apiKey: 'test-key',
  enabled: true,
  asrFallback: true,
};

const originalFetch = globalThis.fetch;

function sseResponse(events) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('云端客户端', () => {
  beforeEach(() => {
    delete globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('配置完整性判断', () => {
    assert.equal(isCloudConfigured(CONFIG), true);
    assert.equal(isCloudConfigured({ ...CONFIG, apiKey: '' }), false);
    assert.equal(isCloudConfigured(undefined), false);
  });

  test('非流式翻译发送 Bearer 头并解析响应', async () => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          requestId: 'r1',
          segments: [{ id: 'cue-1', translation: '你好' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const response = await translateCuesCloud(CONFIG, {
      requestId: 'r1',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'cue-1', text: 'Hello' }],
    });
    assert.equal(captured.url, 'https://cloud.example.com/v1/subtitles/translate');
    assert.equal(captured.init.headers.Authorization, 'Bearer test-key');
    assert.equal(response.segments[0].translation, '你好');
  });

  test('SSE 流式翻译逐段回调，并返回完整结果', async () => {
    const seen = [];
    globalThis.fetch = async () =>
      sseResponse([
        { requestId: 'r2', type: 'start' },
        { requestId: 'r2', type: 'segment', segment: { id: 'cue-1', translation: '甲' } },
        { requestId: 'r2', type: 'segment', segment: { id: 'cue-2', translation: '乙' } },
        {
          requestId: 'r2',
          type: 'done',
          response: {
            requestId: 'r2',
            segments: [
              { id: 'cue-1', translation: '甲' },
              { id: 'cue-2', translation: '乙' },
            ],
          },
        },
      ]);

    const response = await translateCuesCloud(
      CONFIG,
      {
        requestId: 'r2',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        segments: [
          { id: 'cue-1', text: 'A' },
          { id: 'cue-2', text: 'B' },
        ],
      },
      (segment) => seen.push(segment.id)
    );

    assert.deepEqual(seen, ['cue-1', 'cue-2']);
    assert.equal(response.segments.length, 2);
  });

  test('SSE 中途 error 事件抛出带错误码的 CloudApiError', async () => {
    globalThis.fetch = async () =>
      sseResponse([
        { requestId: 'r3', type: 'start' },
        { requestId: 'r3', type: 'error', error: { code: 'RATE_LIMITED', message: '稍后重试' } },
      ]);

    await assert.rejects(
      () =>
        translateCuesCloud(
          CONFIG,
          {
            requestId: 'r3',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            segments: [{ id: 'cue-1', text: 'A' }],
          },
          () => {}
        ),
      (err) => err instanceof CloudApiError && err.code === 'RATE_LIMITED'
    );
  });

  test('非 2xx 响应解析统一错误信封', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: 'AUTH_FAILED', message: 'API Key 无效' } }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );

    await assert.rejects(
      () =>
        extractSubtitlesCloud(CONFIG, { requestId: 'r4', text: '00:00:00,000 --> 00:00:01,000\nA' }),
      (err) => err instanceof CloudApiError && err.code === 'AUTH_FAILED' && err.status === 401
    );
  });
});
