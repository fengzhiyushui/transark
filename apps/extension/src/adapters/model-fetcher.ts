/**
 * 跨协议模型列表拉取器 (Model Fetcher)
 * 支持 OpenAI 兼容端点 (/models)、Ollama (/api/tags)、Anthropic Claude 等
 */
export async function fetchAvailableModels(
  rawBaseUrl: string,
  apiKey?: string,
  protocol?: string
): Promise<string[]> {
  let base = (rawBaseUrl || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('请输入 API 根地址 (BaseUrl)');
  }

  // 清洗后缀
  base = base
    .replace(/\/chat\/completions$/, '')
    .replace(/\/messages$/, '')
    .replace(/\/models$/, '');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  // 1. 若为 Claude 协议，尝试 /v1/models 或返回推荐列表
  if (protocol === 'anthropic-messages' || base.includes('anthropic.com')) {
    try {
      const res = await fetch(`${base}/models`, { method: 'GET', headers });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          return json.data.map((m: any) => m.id);
        }
      }
    } catch {
      // ignore
    }
    return [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ];
  }

  // 2. 尝试标准 OpenAI 规范 ${base}/models
  let lastErrorMsg = '';
  try {
    const res = await fetch(`${base}/models`, {
      method: 'GET',
      headers,
    });
    if (res.ok) {
      const json = await res.json();
      let list: string[] = [];
      if (Array.isArray(json.data)) {
        list = json.data.map((m: any) => m.id).filter(Boolean);
      } else if (Array.isArray(json.models)) {
        list = json.models.map((m: any) => m.name || m.id).filter(Boolean);
      } else if (Array.isArray(json)) {
        list = json.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
      }
      if (list.length > 0) {
        return Array.from(new Set(list)).sort();
      }
    } else {
      lastErrorMsg = `HTTP ${res.status}`;
    }
  } catch (err: any) {
    lastErrorMsg = err?.message || '网络连接失败';
  }

  // 3. 尝试 Ollama 格式 ${base}/api/tags
  try {
    const res = await fetch(`${base}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.models)) {
        const list = json.models.map((m: any) => m.name).filter(Boolean);
        if (list.length > 0) {
          return (Array.from(new Set(list)) as string[]).sort();
        }
      }
    }
  } catch {
    // ignore
  }

  throw new Error(`无法获取模型列表 (${lastErrorMsg || '接口未返回模型列表'})，请检查地址或手动输入模型名称`);
}
