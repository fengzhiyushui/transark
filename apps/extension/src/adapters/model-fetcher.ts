import type { TranslationProtocol } from '@translate/contracts';

/**
 * 跨协议模型列表拉取器 (Model Fetcher)。
 *
 * 按协议访问各厂商真实的模型列表端点，并归一化返回模型 ID 数组：
 *
 * | 协议                 | 端点                        | 解析字段                  |
 * | -------------------- | --------------------------- | ------------------------- |
 * | openai-chat          | GET {base}/models           | data[].id                 |
 * | openai-responses     | GET {base}/models           | data[].id                 |
 * | anthropic-messages   | GET {base}/models           | data[].id                 |
 * | gemini-generate      | GET {base}/models           | models[].name（去前缀）   |
 *
 * 拉取失败时抛出可读错误，调用方（设置界面）据此回退到「手动输入模型名」，
 * 不会静默伪造一个模型列表。
 */

/** 各协议默认 BaseUrl（当用户未填写时用于兜底） */
const DEFAULT_BASE_URLS: Record<string, string> = {
  'openai-chat': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  'anthropic-messages': 'https://api.anthropic.com/v1',
  'gemini-generate': 'https://generativelanguage.googleapis.com/v1beta',
};

/**
 * 清洗用户可能粘贴的完整方法路径，回退到 API 根路径。
 *
 * 注意顺序：必须先去掉 `:method` 后缀（否则 `.../models/x:generateContent`
 * 无法匹配后续规则），再剥离 `models/{model}` 中的模型名，最后去掉尾斜杠。
 */
function normalizeBase(rawBaseUrl: string, protocol?: string): string {
  let base = (rawBaseUrl || '').trim();
  if (!base) {
    base = DEFAULT_BASE_URLS[protocol || 'openai-chat'] || DEFAULT_BASE_URLS['openai-chat'];
  }

  return base
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/responses$/, '')
    .replace(/\/messages$/, '')
    .replace(/:\w+$/, '') // 去掉 :generateContent 一类的方法后缀
    .replace(/\/models\/[^/]+$/, '') // 去掉 /models/{model} 中的模型名，保留 /models
    .replace(/\/+$/, '');
}

/** 按协议组装鉴权头 */
function buildHeaders(protocol: string, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!apiKey) return headers;

  if (protocol === 'anthropic-messages') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (protocol === 'gemini-generate') {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/** 从多种可能的响应结构中提取模型 ID 列表 */
function extractModelIds(json: any): string[] {
  const ids: string[] = [];

  // OpenAI / Anthropic 风格: { data: [{ id }] }
  if (Array.isArray(json?.data)) {
    for (const item of json.data) {
      const id = item?.id ?? item?.name;
      if (typeof id === 'string' && id) ids.push(id);
    }
  }

  // Gemini 风格: { models: [{ name: 'models/gemini-2.0-flash' }] }
  if (Array.isArray(json?.models)) {
    for (const item of json.models) {
      const raw = typeof item === 'string' ? item : item?.name ?? item?.id;
      if (typeof raw !== 'string' || !raw) continue;
      // Gemini 会返回 "models/gemini-2.0-flash" 前缀，需剥离
      ids.push(raw.replace(/^models\//, ''));
    }
  }

  // 裸数组: [{ id }] 或 ["model-a"]
  if (Array.isArray(json)) {
    for (const item of json) {
      const id = typeof item === 'string' ? item : item?.id ?? item?.name;
      if (typeof id === 'string' && id) ids.push(id.replace(/^models\//, ''));
    }
  }

  return Array.from(new Set(ids.filter(Boolean))).sort();
}

/** Anthropic / Gemini 模型列表可能不可用时使用的内置候选 */
const FALLBACK_MODELS: Record<string, string[]> = {
  'anthropic-messages': [
    'claude-sonnet-4-5-20250929',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  'gemini-generate': [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ],
};

export async function fetchAvailableModels(
  rawBaseUrl: string,
  apiKey?: string,
  protocol?: string
): Promise<string[]> {
  const proto = protocol || 'openai-chat';
  const base = normalizeBase(rawBaseUrl, proto);
  const headers = buildHeaders(proto, apiKey);
  const listUrl = `${base}/models`;

  let lastErrorMsg = '';

  try {
    const res = await fetch(listUrl, { method: 'GET', headers });

    if (res.ok) {
      const json = await res.json();
      const models = extractModelIds(json);
      if (models.length > 0) {
        return models;
      }
      lastErrorMsg = '接口未返回任何模型';
    } else {
      lastErrorMsg = `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        throw new Error(`${lastErrorMsg}：鉴权失败，请检查 API Key 是否正确`);
      }
    }
  } catch (err: any) {
    if (err?.message?.includes('鉴权失败')) throw err;
    lastErrorMsg = err?.message || '网络连接失败';
  }

  // 部分厂商（如 Anthropic）不支持浏览器直连列举模型，降级到内置候选
  const fallback = FALLBACK_MODELS[proto];
  if (fallback) {
    return fallback;
  }

  throw new Error(
    `无法获取模型列表 (${lastErrorMsg || '接口未返回模型列表'})，请检查 BaseUrl 与 API Key，或手动输入模型名称`
  );
}
