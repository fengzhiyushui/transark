import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IncrementalSegmentParser, extractSseDataLines } from '../src/adapters/stream-parser.ts';
import { OpenAIChatAdapter } from '../src/adapters/openai-adapter.ts';
import { AnthropicAdapter } from '../src/adapters/anthropic-adapter.ts';
import { GeminiAdapter } from '../src/adapters/gemini-adapter.ts';
import { DEFAULT_OPENAI_CHAT_PROFILE } from '../src/storage/default-configs.ts';

/**
 * 流式解析测试：验证「逐字符到达也能逐段交付」，
 * 这是「首段即回填」能成立的前提。
 */

describe('增量 JSON 段落解析器', () => {
  test('delivers a segment as soon as its object closes, before the stream ends', () => {
    const parser = new IncrementalSegmentParser();

    // 第一段完整到达
    const batch1 = parser.push('{"segments":[{"id":"s1","translation":"你好"}');
    assert.equal(batch1.length, 1);
    assert.deepEqual(batch1[0], { id: 's1', translation: '你好' });

    // 第二段随后到达
    const batch2 = parser.push(',{"id":"s2","translation":"世界"}]}');
    assert.equal(batch2.length, 1);
    assert.deepEqual(batch2[0], { id: 's2', translation: '世界' });
  });

  test('handles character-by-character delivery without duplication', () => {
    const parser = new IncrementalSegmentParser();
    const full = '{"segments":[{"id":"a","translation":"甲"},{"id":"b","translation":"乙"}]}';

    const seen = [];
    for (const ch of full) {
      seen.push(...parser.push(ch));
    }

    assert.equal(seen.length, 2);
    assert.deepEqual(
      seen.map((s) => s.id),
      ['a', 'b']
    );
  });

  test('does not split inside a string containing braces and quotes', () => {
    const parser = new IncrementalSegmentParser();
    const content =
      '{"segments":[{"id":"x","translation":"contains } and { and \\"quoted\\" text"}]}';
    const out = parser.push(content);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'x');
    assert.ok(out[0].translation.includes('}'));
    assert.ok(out[0].translation.includes('{'));
  });

  test('tolerates markdown fences and leading prose before the JSON', () => {
    const parser = new IncrementalSegmentParser();
    const out = parser.push('```json\n{"segments":[{"id":"m","translation":"围栏"}]}\n```');
    assert.deepEqual(out, [{ id: 'm', translation: '围栏' }]);
  });

  test('stops emitting once the segments array is closed', () => {
    const parser = new IncrementalSegmentParser();
    const out = parser.push('{"segments":[{"id":"z","translation":"尾"}]}');
    assert.equal(out.length, 1);
    // 后续无关内容不应再产出段落
    assert.equal(parser.push('garbage after').length, 0);
  });
});

describe('SSE data 行提取', () => {
  test('extracts data payloads and ignores [DONE] and comments', () => {
    const chunk = [
      ': keep-alive comment',
      '',
      'data: {"a":1}',
      '',
      'data:{"a":2}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    assert.deepEqual(extractSseDataLines(chunk), ['{"a":1}', '{"a":2}']);
  });

  test('ignores non-data lines such as event: and id:', () => {
    const chunk = 'event: message_start\nid: 42\ndata: {"x":1}\n';
    assert.deepEqual(extractSseDataLines(chunk), ['{"x":1}']);
  });
});

describe('各协议流式增量抽取', () => {
  test('OpenAI Chat Completions reads choices[0].delta.content', () => {
    const a = new OpenAIChatAdapter(DEFAULT_OPENAI_CHAT_PROFILE);
    assert.equal(a['extractStreamDelta']({ choices: [{ delta: { content: 'hi' } }] }), 'hi');
    assert.equal(a['extractStreamDelta']({ choices: [{ delta: {} }] }), null);
    assert.equal(a['extractStreamDelta']({}), null);
  });

  test('OpenAI Responses reads response.output_text.delta', () => {
    const a = new OpenAIChatAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'openai-responses',
    });
    assert.equal(
      a['extractStreamDelta']({ type: 'response.output_text.delta', delta: 'abc' }),
      'abc'
    );
    // 其他事件类型不含文本
    assert.equal(a['extractStreamDelta']({ type: 'response.completed' }), null);
  });

  test('Anthropic reads content_block_delta.text', () => {
    const a = new AnthropicAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'anthropic-messages',
    });
    assert.equal(
      a['extractStreamDelta']({ type: 'content_block_delta', delta: { text: '嘿' } }),
      '嘿'
    );
    assert.equal(a['extractStreamDelta']({ type: 'message_start' }), null);
  });

  test('Gemini reads candidates[0].content.parts[].text', () => {
    const a = new GeminiAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'gemini-generate',
    });
    assert.equal(
      a['extractStreamDelta']({ candidates: [{ content: { parts: [{ text: 'X' }] } }] }),
      'X'
    );
    assert.equal(a['extractStreamDelta']({ candidates: [] }), null);
  });
});

describe('流式端点与请求体', () => {
  test('OpenAI adds stream:true and drops response_format on chat', () => {
    const a = new OpenAIChatAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      capabilities: { textTranslation: true, ocr: false, asr: false, structuredOutput: true },
    });
    const payload = a['buildStreamPayload']({
      requestId: 'r',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 's', text: 'x' }],
    });
    assert.equal(payload.stream, true);
    assert.equal(payload.response_format, undefined);
  });

  test('Anthropic adds stream:true and keeps top-level system', () => {
    const a = new AnthropicAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'anthropic-messages',
    });
    const payload = a['buildStreamPayload']({
      requestId: 'r',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 's', text: 'x' }],
    });
    assert.equal(payload.stream, true);
    assert.ok(typeof payload.system === 'string');
  });

  test('Gemini switches to streamGenerateContent with alt=sse', () => {
    const a = new GeminiAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'gemini-generate',
      model: 'gemini-2.5-flash',
      capabilities: { textTranslation: true, ocr: false, asr: false, streaming: true },
    });
    const url = a['resolveStreamEndpoint']();
    assert.ok(url.includes(':streamGenerateContent'), url);
    assert.ok(url.includes('alt=sse'), url);
  });
});

describe('流式失败时回退为非流式', () => {
  test('falls back when the response body lacks a readable stream', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;

    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        // 首次（流式）：content-type 声明为 event-stream 但没有 body
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'text/event-stream' },
          body: null,
        };
      }
      // 回退（非流式）：返回正常 JSON
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        body: null,
        json: async () => ({
          choices: [
            { message: { content: '{"segments":[{"id":"s1","translation":"回退成功"}]}' } },
          ],
        }),
      };
    };

    try {
      const a = new OpenAIChatAdapter({
        ...DEFAULT_OPENAI_CHAT_PROFILE,
        capabilities: { textTranslation: true, ocr: false, asr: false, streaming: true },
      });
      const deltas = [];
      const res = await a.translate(
        {
          requestId: 'r-fallback',
          sourceLanguage: 'en',
          targetLanguage: 'zh-CN',
          segments: [{ id: 's1', text: 'Hello' }],
        },
        undefined,
        (seg) => deltas.push(seg)
      );

      assert.equal(callCount, 2, 'should retry without streaming');
      assert.equal(res.segments[0].translation, '回退成功');
      assert.equal(deltas.length, 1, 'fallback should still emit segments to the callback');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
