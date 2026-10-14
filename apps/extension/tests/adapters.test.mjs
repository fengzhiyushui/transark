import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIChatAdapter } from '../src/adapters/openai-adapter.ts';
import { AnthropicAdapter } from '../src/adapters/anthropic-adapter.ts';
import { GeminiAdapter } from '../src/adapters/gemini-adapter.ts';
import { LocalAccessAdapter } from '../src/adapters/local-adapter.ts';
import { createTranslationProvider } from '../src/adapters/provider-factory.ts';
import { DEFAULT_OPENAI_CHAT_PROFILE, DEFAULT_LOCAL_PROFILE } from '../src/storage/default-configs.ts';
import { fastTextHash, generateSegmentId } from '../src/core/hash.ts';

describe('输出 Token 预算（max_tokens 语义）', () => {
  const mkRequest = (texts) => ({
    requestId: 'r',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    segments: texts.map((t, i) => ({ id: `s${i}`, text: t })),
  });

  test('Anthropic max_tokens is an output budget, not maxInputLength', () => {
    const a = new AnthropicAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'anthropic-messages',
      limits: { maxInputLength: 16000, maxBatchSize: 20 },
    });

    const payload = a['buildPayload'](mkRequest(['Hello world']));
    // 关键断言：不能再出现「输入上限被当作生成上限」的 16000
    assert.notEqual(payload.max_tokens, 16000);
    assert.ok(payload.max_tokens >= 1024, `应有合理下限，实际 ${payload.max_tokens}`);
    assert.ok(payload.max_tokens <= 8192, `应受上限约束，实际 ${payload.max_tokens}`);
  });

  test('honors an explicit maxOutputTokens override', () => {
    const a = new AnthropicAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'anthropic-messages',
      limits: { maxInputLength: 16000, maxOutputTokens: 2048 },
    });
    const payload = a['buildPayload'](mkRequest(['Hello']));
    assert.equal(payload.max_tokens, 2048);
  });

  test('scales the budget with total input volume', () => {
    const a = new AnthropicAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'anthropic-messages',
    });

    const small = a['maxOutputTokens'](mkRequest(['hi']));
    const large = a['maxOutputTokens'](mkRequest([('word ').repeat(400)]));

    assert.ok(large > small, `长文本预算应更大: ${large} vs ${small}`);
    assert.ok(large <= 8192, `不应超过上限: ${large}`);
  });

  test('never returns a zero or negative budget for empty input', () => {
    const a = new AnthropicAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'anthropic-messages',
    });
    const budget = a['maxOutputTokens'](mkRequest([]));
    assert.ok(budget >= 1024, `空输入也应保底，实际 ${budget}`);
  });

  test('OpenAI and Gemini adapters do not send a bogus max_tokens', () => {
    const oa = new OpenAIChatAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      limits: { maxInputLength: 16000 },
    });
    assert.equal(oa['buildPayload'](mkRequest(['x'])).max_tokens, undefined);

    const gm = new GeminiAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      protocol: 'gemini-generate',
      limits: { maxInputLength: 16000 },
    });
    assert.equal(gm['buildPayload'](mkRequest(['x'])).max_tokens, undefined);
  });
});

describe('Hash and Segment ID', () => {
  test('fastTextHash produces consistent deterministic 32-bit hex', () => {
    const text = 'Hello, world!';
    const hash1 = fastTextHash(text);
    const hash2 = fastTextHash(text);
    assert.equal(hash1, hash2);
    assert.ok(hash1.length >= 6);

    const hashDiff = fastTextHash('Hello world');
    assert.notEqual(hash1, hashDiff);
  });

  test('generateSegmentId generates unique stable IDs with hash', () => {
    const id1 = generateSegmentId(0, 'Hello, world!');
    const id2 = generateSegmentId(1, 'Hello, world!');
    assert.ok(id1.startsWith('seg-0-'));
    assert.ok(id2.startsWith('seg-1-'));
    assert.notEqual(id1, id2);
  });
});

describe('OpenAI 兼容协议适配器 (Chat Completions)', () => {
  const adapter = new OpenAIChatAdapter({
    ...DEFAULT_OPENAI_CHAT_PROFILE,
    baseUrl: 'https://api.openai.com/v1',
    auth: { type: 'bearer', apiKey: 'sk-test-secret-key' },
  });

  test('resolves the chat completions endpoint', () => {
    assert.equal(adapter['resolveEndpoint'](), 'https://api.openai.com/v1/chat/completions');
  });

  test('does not double-append when full path already provided', () => {
    const full = new OpenAIChatAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    });
    assert.equal(full['resolveEndpoint'](), 'https://api.deepseek.com/v1/chat/completions');
  });

  test('builds bearer auth header and respects custom header name', () => {
    const headers = adapter['buildHeaders']();
    assert.equal(headers['Authorization'], 'Bearer sk-test-secret-key');
    assert.equal(headers['Content-Type'], 'application/json');

    const custom = new OpenAIChatAdapter({
      ...DEFAULT_OPENAI_CHAT_PROFILE,
      auth: { type: 'custom', apiKey: 'custom-key', headerName: 'X-Api-Token' },
    });
    assert.equal(custom['buildHeaders']()['X-Api-Token'], 'custom-key');
    assert.equal(custom['buildHeaders']()['Authorization'], undefined);
  });

  test('parses chat completions content and usage', () => {
    const content = adapter['extractContent']({
      choices: [{ message: { content: '{"segments":[]}' } }],
    });
    assert.equal(content, '{"segments":[]}');

    const usage = adapter['extractUsage']({
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    });
    assert.deepEqual(usage, { promptTokens: 12, completionTokens: 34 });
  });
});

describe('OpenAI Responses API 适配器', () => {
  const adapter = new OpenAIChatAdapter({
    ...DEFAULT_OPENAI_CHAT_PROFILE,
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
  });

  test('resolves the responses endpoint', () => {
    assert.equal(adapter['resolveEndpoint'](), 'https://api.openai.com/v1/responses');
  });

  test('uses instructions + input instead of messages', () => {
    const payload = adapter['buildPayload']({
      requestId: 'r1',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 's1', text: 'Hello' }],
    });
    assert.equal(payload.messages, undefined);
    assert.ok(typeof payload.instructions === 'string');
    assert.equal(payload.model, 'deepseek-chat');
    assert.deepEqual(payload.text, { format: { type: 'json_object' } });
  });

  test('extracts output_text and nested output content', () => {
    assert.equal(adapter['extractContent']({ output_text: 'direct' }), 'direct');

    const nested = adapter['extractContent']({
      output: [{ content: [{ type: 'output_text', text: 'part-a' }, { type: 'output_text', text: 'part-b' }] }],
    });
    assert.equal(nested, 'part-apart-b');
  });

  test('maps responses token usage field names', () => {
    const usage = adapter['extractUsage']({
      usage: { input_tokens: 7, output_tokens: 9 },
    });
    assert.deepEqual(usage, { promptTokens: 7, completionTokens: 9 });
  });
});

describe('Anthropic Messages 协议适配器', () => {
  const adapter = new AnthropicAdapter({
    profileId: 'claude-test',
    revision: 1,
    name: 'Claude Test',
    accessMode: 'api',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
    auth: { type: 'api-key', apiKey: 'sk-ant-test-key' },
    dataPolicy: 'allow-cloud',
    capabilities: { textTranslation: true, ocr: false, asr: false },
  });

  test('resolves endpoint and required anthropic headers', () => {
    assert.equal(adapter['resolveEndpoint'](), 'https://api.anthropic.com/v1/messages');
    const headers = adapter['buildHeaders']();
    assert.equal(headers['x-api-key'], 'sk-ant-test-key');
    assert.equal(headers['anthropic-version'], '2023-06-01');
    assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
  });

  test('places the system prompt at the top level, not in messages', () => {
    const payload = adapter['buildPayload']({
      requestId: 'r1',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 's1', text: 'Hello' }],
    });
    assert.ok(typeof payload.system === 'string');
    assert.equal(payload.messages.length, 1);
    assert.equal(payload.messages[0].role, 'user');
  });

  test('extracts only text-type content blocks', () => {
    const content = adapter['extractContent']({
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'tool_use', id: 't1' },
        { type: 'text', text: 'world' },
      ],
    });
    assert.equal(content, 'hello world');
  });
});

describe('Google Gemini 协议适配器', () => {
  const adapter = new GeminiAdapter({
    profileId: 'gemini-test',
    revision: 1,
    name: 'Gemini Test',
    accessMode: 'api',
    protocol: 'gemini-generate',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    auth: { type: 'api-key', apiKey: 'goog-test-key' },
    dataPolicy: 'allow-cloud',
    capabilities: { textTranslation: true, ocr: false, asr: false, structuredOutput: true },
  });

  test('resolves the generateContent endpoint with model in path', () => {
    assert.equal(
      adapter['resolveEndpoint'](),
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    );
  });

  test('does not duplicate /models when base already ends with it', () => {
    const withModels = new GeminiAdapter({
      ...adapter.config,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    });
    assert.equal(
      withModels['resolveEndpoint'](),
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    );
  });

  test('uses x-goog-api-key header auth', () => {
    assert.equal(adapter['buildHeaders']()['x-goog-api-key'], 'goog-test-key');
  });

  test('builds systemInstruction and responseMimeType payload', () => {
    const payload = adapter['buildPayload']({
      requestId: 'r1',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 's1', text: 'Hello' }],
    });
    assert.ok(Array.isArray(payload.systemInstruction.parts));
    assert.equal(payload.contents[0].role, 'user');
    assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  });

  test('extracts candidate parts and maps usageMetadata', () => {
    const content = adapter['extractContent']({
      candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }],
    });
    assert.equal(content, 'ab');

    assert.deepEqual(
      adapter['extractUsage']({ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 } }),
      { promptTokens: 5, completionTokens: 6 }
    );
  });
});

describe('模型输出的容错解析', () => {
  const adapter = new OpenAIChatAdapter(DEFAULT_OPENAI_CHAT_PROFILE);

  test('parses plain JSON object, bare array, and markdown-fenced JSON', () => {
    assert.deepEqual(adapter['parseSegments']('{"segments":[{"id":"a","translation":"甲"}]}', 'test'), [
      { id: 'a', translation: '甲' },
    ]);
    assert.deepEqual(adapter['parseSegments']('[{"id":"b","translation":"乙"}]', 'test'), [
      { id: 'b', translation: '乙' },
    ]);
    assert.deepEqual(
      adapter['parseSegments']('```json\n{"segments":[{"id":"c","translation":"丙"}]}\n```', 'test'),
      [{ id: 'c', translation: '丙' }]
    );
  });

  test('recovers JSON embedded in extra prose text', () => {
    const wrapped = 'Here is the result:\n{"segments":[{"id":"d","translation":"丁"}]}\nHope this helps!';
    assert.deepEqual(adapter['parseSegments'](wrapped, 'test'), [{ id: 'd', translation: '丁' }]);
  });

  test('throws ALIGNMENT_MISMATCH for unparseable output', () => {
    assert.throws(
      () => adapter['parseSegments']('this is not json at all', 'test'),
      (err) => err.code === 'ALIGNMENT_MISMATCH'
    );
  });

  test('throws ALIGNMENT_MISMATCH when segments array is missing', () => {
    assert.throws(
      () => adapter['parseSegments']('{"result":"ok"}', 'test'),
      (err) => err.code === 'ALIGNMENT_MISMATCH'
    );
  });
});

describe('接入方式分派 (Provider Factory)', () => {
  test('dispatches every supported API protocol to an adapter', () => {
    const base = { ...DEFAULT_OPENAI_CHAT_PROFILE, accessMode: 'api' };
    assert.ok(
      createTranslationProvider({ ...base, protocol: 'openai-chat' }) instanceof OpenAIChatAdapter
    );
    assert.ok(
      createTranslationProvider({ ...base, protocol: 'openai-responses' }) instanceof OpenAIChatAdapter
    );
    assert.ok(
      createTranslationProvider({ ...base, protocol: 'anthropic-messages' }) instanceof AnthropicAdapter
    );
    assert.ok(
      createTranslationProvider({ ...base, protocol: 'gemini-generate' }) instanceof GeminiAdapter
    );
  });

  test('local access mode yields the placeholder adapter', () => {
    const provider = createTranslationProvider(DEFAULT_LOCAL_PROFILE);
    assert.ok(provider instanceof LocalAccessAdapter);
  });

  test('local access refuses to translate instead of faking success', async () => {
    const provider = new LocalAccessAdapter(DEFAULT_LOCAL_PROFILE);
    await assert.rejects(
      () =>
        provider.translate({
          requestId: 'r1',
          sourceLanguage: 'en',
          targetLanguage: 'zh-CN',
          segments: [{ id: 's1', text: 'Hello' }],
        }),
      (err) => err.code === 'MODEL_UNAVAILABLE'
    );
  });

  test('rejects unknown protocols with UNSUPPORTED_PROTOCOL', () => {
    assert.throws(
      () =>
        createTranslationProvider({
          ...DEFAULT_OPENAI_CHAT_PROFILE,
          protocol: 'some-unknown-protocol',
        }),
      (err) => err.code === 'UNSUPPORTED_PROTOCOL'
    );
  });
});

describe('HTTP 状态码 → 统一错误码映射', () => {
  const adapter = new OpenAIChatAdapter(DEFAULT_OPENAI_CHAT_PROFILE);

  const cases = [
    [401, 'AUTH_FAILED'],
    [403, 'AUTH_FAILED'],
    [429, 'RATE_LIMITED'],
    [404, 'MODEL_UNAVAILABLE'],
    [400, 'INVALID_REQUEST'],
    [500, 'MODEL_UNAVAILABLE'],
  ];

  for (const [status, expected] of cases) {
    test(`HTTP ${status} maps to ${expected}`, () => {
      assert.throws(
        () => adapter['raiseHttpError'](status, 'err', 'test'),
        (err) => err.code === expected
      );
    });
  }
});
