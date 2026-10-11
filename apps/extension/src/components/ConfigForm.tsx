import React, { useState } from 'react';
import type {
  TranslationProviderConfig,
  DataPolicy,
  TranslationProtocol,
  AuthType,
} from '@translate/contracts';
import { testProviderConnection, fetchModels } from '../messaging/client';
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Key,
  Link as LinkIcon,
  Cpu,
  ShieldCheck,
  ChevronDown,
  Sparkles,
  Download,
} from 'lucide-react';

interface ConfigFormProps {
  initialConfig: TranslationProviderConfig;
  onSave: (config: TranslationProviderConfig) => void;
  onDelete?: (profileId: string) => void;
  onCancel?: () => void;
}

export const ConfigForm: React.FC<ConfigFormProps> = ({
  initialConfig,
  onSave,
  onDelete,
  onCancel,
}) => {
  const [config, setConfig] = useState<TranslationProviderConfig>({ ...initialConfig });
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    durationMs?: number;
    sampleTranslation?: string;
    error?: string;
  } | null>(null);

  // 拉取模型列表
  const handleFetchModels = async () => {
    if (!config.baseUrl) {
      setFetchError('请先填写 API 根地址 (BaseUrl)');
      return;
    }
    setFetchingModels(true);
    setFetchError(null);
    try {
      const apiKey = config.auth?.apiKey || config.auth?.token;
      const list = await fetchModels(config.baseUrl, apiKey, config.protocol);
      setModelList(list);
      if (list.length > 0 && !list.includes(config.model)) {
        setConfig((prev) => ({ ...prev, model: list[0] }));
      }
    } catch (err: any) {
      setFetchError(err?.message || '获取模型列表失败，请确认地址与密钥后重试');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testProviderConnection(config);
      setTestResult({
        success: true,
        durationMs: res.durationMs,
        sampleTranslation: res.sampleTranslation,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err?.message || '连接测试失败，请检查 BaseUrl 或模型名称',
      });
    } finally {
      setTesting(false);
    }
  };

  const isBuiltin = config.protocol === 'chrome-builtin' || config.protocol === 'mock';
  const isClaude = config.protocol === 'anthropic-messages';

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            {config.profileId ? '编辑模型服务配置' : '新增通用模型配置'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            精简协议适配：支持 OpenAI (双协议)、Claude 官方协议及浏览器内置端侧引擎
          </p>
        </div>
        <span className="font-mono text-[11px] text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
          ID: {config.profileId}
        </span>
      </div>

      <div className="space-y-4">
        {/* 1. 基础配置 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700">配置名称</label>
            <input
              type="text"
              className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 transition-all"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              placeholder="例如：DeepSeek V3 / 本地 Ollama / Claude 3.5"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">通用协议类型</label>
            <select
              className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 cursor-pointer transition-all"
              value={config.protocol}
              onChange={(e) => {
                const proto = e.target.value as TranslationProtocol;
                let defaultUrl = config.baseUrl;
                let defaultModel = config.model;
                let policy = config.dataPolicy;

                if (proto === 'anthropic-messages') {
                  defaultUrl = 'https://api.anthropic.com/v1';
                  defaultModel = 'claude-3-5-sonnet-20241022';
                  policy = 'allow-cloud';
                } else if (proto === 'chrome-builtin') {
                  defaultUrl = 'chrome://builtin';
                  defaultModel = 'chrome-on-device-translator';
                  policy = 'device-only';
                } else if (proto === 'mock') {
                  defaultUrl = 'internal://mock';
                  defaultModel = 'mock-engine-v1';
                  policy = 'device-only';
                } else if (proto === 'openai-chat' || proto === 'openai-responses') {
                  if (defaultUrl.startsWith('chrome:') || defaultUrl.startsWith('internal:')) {
                    defaultUrl = 'https://api.deepseek.com/v1';
                    defaultModel = 'deepseek-chat';
                  }
                  policy = defaultUrl.includes('127.0.0.1') || defaultUrl.includes('localhost') ? 'device-only' : 'allow-cloud';
                }

                setConfig({
                  ...config,
                  protocol: proto,
                  baseUrl: defaultUrl,
                  model: defaultModel,
                  dataPolicy: policy,
                  auth: {
                    ...config.auth,
                    type: proto === 'chrome-builtin' || proto === 'mock' ? 'none' : isClaude ? 'api-key' : 'bearer',
                  },
                });
                setModelList([]);
                setFetchError(null);
              }}
            >
              <option value="openai-chat">OpenAI 标准 ChatCompletions (推荐：DeepSeek/OpenAI/本地网关)</option>
              <option value="openai-responses">OpenAI 新一代 Structured Outputs / Responses 协议</option>
              <option value="anthropic-messages">Claude 官方协议 (Anthropic Messages API)</option>
              <option value="chrome-builtin">Chrome 浏览器端侧极速翻译 (内置/免配置)</option>
              <option value="mock">内置离线模拟 (Mock 免配极速体验)</option>
            </select>
          </div>
        </div>

        {/* 2. BaseUrl 与 API Key (若非内置引擎) */}
        {!isBuiltin && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <LinkIcon className="h-3.5 w-3.5 text-blue-600" />
                <span>API 根地址 (BaseUrl)</span>
              </label>
              <input
                type="text"
                className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 transition-all"
                value={config.baseUrl}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1 或 http://127.0.0.1:11434"
              />
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Key className="h-3.5 w-3.5 text-amber-500" />
                <span>API 密钥 (API Key，本地端点可留空)</span>
              </label>
              <input
                type="password"
                className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 transition-all"
                value={config.auth?.apiKey || config.auth?.token || ''}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    auth: {
                      ...config.auth,
                      apiKey: e.target.value,
                      token: e.target.value,
                    },
                  })
                }
                placeholder="sk-..."
              />
            </div>
          </div>
        )}

        {/* 3. 模型标识 (支持一键拉取并下拉选择) */}
        {!isBuiltin && (
          <div className="rounded-xl bg-slate-50/80 p-4 border border-slate-100 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Cpu className="h-3.5 w-3.5 text-indigo-600" />
                <span>模型标识 (Model)</span>
              </label>

              <button
                type="button"
                onClick={handleFetchModels}
                disabled={fetchingModels}
                className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download className={`h-3 w-3 ${fetchingModels ? 'animate-bounce' : ''}`} />
                <span>{fetchingModels ? '正在拉取...' : '点击一键拉取可用模型 ⚡'}</span>
              </button>
            </div>

            {/* 若获取到了模型列表，展示下拉框，同时允许手动输入 */}
            {modelList.length > 0 ? (
              <div className="space-y-1.5">
                <select
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  className="block w-full rounded-xl border border-blue-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 cursor-pointer shadow-2xs"
                >
                  {modelList.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span className="text-emerald-700 font-medium">✓ 已成功拉取到 {modelList.length} 个模型</span>
                  <button
                    type="button"
                    onClick={() => setModelList([])}
                    className="text-slate-400 hover:text-slate-600 underline cursor-pointer"
                  >
                    切换为手动输入
                  </button>
                </div>
              </div>
            ) : (
              <input
                type="text"
                className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 transition-all"
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                placeholder="例如 deepseek-chat, gpt-4o-mini, qwen2.5:7b, claude-3-5-sonnet-20241022"
              />
            )}

            {fetchError && (
              <p className="text-[11px] text-rose-600 font-medium">{fetchError}</p>
            )}
          </div>
        )}

        {/* 浏览器内置引擎提示 */}
        {config.protocol === 'chrome-builtin' && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 text-xs text-blue-900 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span>Chrome 实验性端侧翻译引擎 (免配置极速)</span>
            </div>
            <p className="text-[11px] text-blue-800/80 leading-relaxed">
              利用 Chrome 128+ 内置端侧 NPU/CPU 翻译模型，直接在本地设备执行翻译，0 外部网络、0 额外开销。若未启用可在地址栏访问 <code className="bg-white/70 px-1 rounded font-mono">chrome://flags/#translation-api</code> 开启体验。
            </p>
          </div>
        )}
      </div>

      {/* 测试反馈 */}
      {testResult && (
        <div
          className={`flex items-start gap-2.5 rounded-xl p-3 text-xs transition-all ${
            testResult.success
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {testResult.success ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
          )}
          <div className="space-y-0.5">
            <p className="font-bold">
              {testResult.success
                ? `连通测试通过！(往返耗时: ${testResult.durationMs}ms)`
                : '连通测试失败'}
            </p>
            {testResult.sampleTranslation && (
              <p className="text-emerald-700">
                测试样本：<span className="font-semibold">"{testResult.sampleTranslation}"</span>
              </p>
            )}
            {testResult.error && <p className="text-rose-700 font-mono">{testResult.error}</p>}
          </div>
        </div>
      )}

      {/* 底部按钮区 */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 active:scale-95 transition-all cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
          <span>{testing ? '正在测试...' : '测试连通性'}</span>
        </button>

        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(config.profileId)}
              className="rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 active:scale-95 transition-all cursor-pointer"
            >
              删除
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer"
            >
              取消
            </button>
          )}
          <button
            type="button"
            onClick={() => onSave(config)}
            className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 active:scale-95 transition-all cursor-pointer"
          >
            保存并生效
          </button>
        </div>
      </div>
    </div>
  );
};
