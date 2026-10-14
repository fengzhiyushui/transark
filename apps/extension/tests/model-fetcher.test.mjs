import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAvailableModels } from '../src/adapters/model-fetcher.ts';

/**
 * 模型获取与选择的单元测试。
 * 通过替换 globalThis.fetch 桩来验证四种 API 协议的端点拼接与响应解析，
 * 不产生任何真实网络请求。
 */

let originalFetch;
let calls;

function stubFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('模型列表获取 — OpenAI 兼容协议', () => {
  test('parses data[].id from /models and sorts/dedupes', async () => {
    stubFetch(() =>
      jsonResponse({
        data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-4o' }],
      })
    );

    const models = await fetchAvailableModels('https://api.openai.com/v1', 'sk-x', 'openai-chat');
    assert.deepEqual(models, ['gpt-4o', 'gpt-4o-mini']);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
    assert.equal(calls[0].init.headers['Authorization'], 'Bearer sk-x');
  });

  test('strips an accidentally included /chat/completions suffix', async () => {
    stubFetch(() => jsonResponse({ data: [{ id: 'deepseek-chat' }] }));
    await fetchAvailableModels('https://api.deepseek.com/v1/chat/completions', 'sk-x', 'openai-chat');
    assert.equal(calls[0].url, 'https://api.deepseek.com/v1/models');
  });

  test('supports bare array responses from some gateways', async () => {
    stubFetch(() => jsonResponse(['model-a', 'model-b']));
    const models = await fetchAvailableModels('http://127.0.0.1:8000/v1', undefined, 'openai-chat');
    assert.deepEqual(models, ['model-a', 'model-b']);
  });

  test('surfaces auth failures distinctly', async () => {
    stubFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
    await assert.rejects(
      () => fetchAvailableModels('https://api.openai.com/v1', 'bad-key', 'openai-chat'),
      /鉴权失败/
    );
  });
});

describe('模型列表获取 — Anthropic Messages', () => {
  test('uses x-api-key plus version headers', async () => {
    stubFetch(() => jsonResponse({ data: [{ id: 'claude-3-5-sonnet-20241022' }] }));
    const models = await fetchAvailableModels('https://api.anthropic.com/v1', 'sk-ant', 'anthropic-messages');

    assert.deepEqual(models, ['claude-3-5-sonnet-20241022']);
    assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant');
    assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
  });

  test('falls back to builtin candidates when listing is unavailable', async () => {
    stubFetch(() => jsonResponse({ error: 'not supported' }, 404));
    const models = await fetchAvailableModels('https://api.anthropic.com/v1', 'sk-ant', 'anthropic-messages');
    assert.ok(models.length > 0);
    assert.ok(models.some((m) => m.startsWith('claude-')));
  });
});

describe('模型列表获取 — Google Gemini', () => {
  test('parses models[].name and strips the models/ prefix', async () => {
    stubFetch(() =>
      jsonResponse({
        models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-pro' }],
      })
    );

    const models = await fetchAvailableModels(
      'https://generativelanguage.googleapis.com/v1beta',
      'goog-key',
      'gemini-generate'
    );
    assert.deepEqual(models, ['gemini-2.5-flash', 'gemini-2.5-pro']);
    assert.equal(calls[0].init.headers['x-goog-api-key'], 'goog-key');
  });

  test('strips a :generateContent method suffix from the base url', async () => {
    stubFetch(() => jsonResponse({ models: [{ name: 'models/gemini-2.0-flash' }] }));
    const models = await fetchAvailableModels(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      'goog-key',
      'gemini-generate'
    );
    assert.deepEqual(models, ['gemini-2.0-flash']);
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models');
  });

  test('falls back to builtin candidates when listing fails', async () => {
    stubFetch(() => {
      throw new Error('network down');
    });
    const models = await fetchAvailableModels(
      'https://generativelanguage.googleapis.com/v1beta',
      'goog-key',
      'gemini-generate'
    );
    assert.ok(models.some((m) => m.startsWith('gemini-')));
  });
});

describe('模型列表获取 — 失败路径', () => {
  test('raises a readable error when no models can be resolved', async () => {
    stubFetch(() => jsonResponse({ data: [] }));
    await assert.rejects(
      () => fetchAvailableModels('https://api.openai.com/v1', 'sk-x', 'openai-chat'),
      /接口未返回任何模型/
    );
  });

  test('reports network failures rather than silently returning empty', async () => {
    stubFetch(() => {
      throw new Error('ENOTFOUND');
    });
    await assert.rejects(
      () => fetchAvailableModels('https://api.openai.com/v1', 'sk-x', 'openai-chat'),
      /ENOTFOUND/
    );
  });
});
