import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider } from '../src/adapters/mock-adapter.ts';
import { OpenAIChatAdapter } from '../src/adapters/openai-adapter.ts';
import { OllamaAdapter } from '../src/adapters/ollama-adapter.ts';
import { DEFAULT_MOCK_PROFILE, DEFAULT_OLLAMA_PROFILE, DEFAULT_OPENAI_PROFILE } from '../src/storage/default-configs.ts';
import { fastTextHash, generateSegmentId } from '../src/core/hash.ts';

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

describe('MockProvider (Offline Development Engine)', () => {
  test('MockProvider translates known and generic segments with strict alignment', async () => {
    const provider = new MockProvider(DEFAULT_MOCK_PROFILE, 10);
    const request = {
      requestId: 'req-test-mock-01',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [
        { id: 's1', text: 'Hello, world!' },
        { id: 's2', text: 'This is a cross-platform browser translation extension built with Manifest V3 and WXT.' },
        { id: 's3', text: 'A custom technical paragraph about offline local processing.' },
      ],
    };

    const response = await provider.translate(request);
    assert.equal(response.requestId, request.requestId);
    assert.equal(response.segments.length, 3);
    assert.equal(response.segments[0].id, 's1');
    assert.equal(response.segments[0].translation, '你好，世界！');
    assert.equal(response.segments[1].id, 's2');
    assert.ok(response.segments[1].translation.includes('Manifest V3'));
    assert.equal(response.segments[2].id, 's3');
    assert.ok(response.segments[2].translation.length > 0);
    assert.equal(response.resolvedEngine?.actualLocation, 'local');
  });

  test('MockProvider testConnection returns latency and sample', async () => {
    const provider = new MockProvider(DEFAULT_MOCK_PROFILE, 5);
    const conn = await provider.testConnection();
    assert.ok(conn.durationMs >= 0);
    assert.equal(conn.sampleTranslation, '你好，世界！');
  });
});

describe('OpenAIChatAdapter and OllamaAdapter Assembly', () => {
  test('OpenAIChatAdapter formats endpoint and headers correctly', () => {
    const adapter = new OpenAIChatAdapter({
      ...DEFAULT_OPENAI_PROFILE,
      baseUrl: 'https://api.openai.com/v1',
      auth: { type: 'bearer', apiKey: 'sk-test-secret-key' },
    });
    // Test endpoint resolution
    assert.equal(adapter['resolveEndpoint'](), 'https://api.openai.com/v1/chat/completions');
    const headers = adapter['buildHeaders']();
    assert.equal(headers['Authorization'], 'Bearer sk-test-secret-key');
    assert.equal(headers['Content-Type'], 'application/json');
  });

  test('OllamaAdapter formats endpoint correctly', () => {
    const adapter = new OllamaAdapter({
      ...DEFAULT_OLLAMA_PROFILE,
      baseUrl: 'http://127.0.0.1:11434',
    });
    assert.equal(adapter['resolveEndpoint'](), 'http://127.0.0.1:11434/api/chat');
  });

  test('AnthropicAdapter formats endpoint and headers correctly', async () => {
    const { AnthropicAdapter } = await import('../src/adapters/anthropic-adapter.ts');
    const adapter = new AnthropicAdapter({
      profileId: 'claude-test',
      revision: 1,
      name: 'Claude Test',
      protocol: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-20241022',
      auth: { type: 'api-key', apiKey: 'sk-ant-test-key' },
      dataPolicy: 'allow-cloud',
      capabilities: { textTranslation: true, ocr: false, asr: false },
    });
    assert.equal(adapter['resolveEndpoint'](), 'https://api.anthropic.com/v1/messages');
    const headers = adapter['buildHeaders']();
    assert.equal(headers['x-api-key'], 'sk-ant-test-key');
    assert.equal(headers['anthropic-version'], '2023-06-01');
    assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
  });

  test('ChromeBuiltinAdapter detects environment capability', async () => {
    const { ChromeBuiltinAdapter } = await import('../src/adapters/chrome-builtin-adapter.ts');
    const isSupported = ChromeBuiltinAdapter.isSupported();
    assert.equal(typeof isSupported, 'boolean');
  });
});

