import React, { useState } from 'react';
import type {
  TranslationProviderConfig,
  AccessMode,
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
  Info,
  Download,
} from 'lucide-react';

interface ConfigFormProps {
  initialConfig: TranslationProviderConfig;
  onSave: (config: TranslationProviderConfig) => void;
  onDelete?: (profileId: string) => void;
  onCancel?: () => void;
}

/** 各 API 协议的默认端点、模型与鉴权方式 */
const PROTOCOL_PRESETS: Record<
  string,
  { baseUrl: string; model: string; authType: AuthType; policy: 'allow-cloud' | 'device-only' }
> = {
  'openai-chat': {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    authType: 'bearer',
    policy: 'allow-cloud',
  },
  'openai-responses': {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    authType: 'bearer',
    policy: 'allow-cloud',
  },
  'anthropic-messages': {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
    authType: 'api-key',
    policy: 'allow-cloud',
  },
  'gemini-generate': {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    authType: 'api-key',
    policy: 'allow-cloud',
  },
};

const PROTOCOL_LABELS: Record<string, string> = {
  'openai-chat': 'OpenAI 兼容 (Chat Completions) — DeepSeek / Kimi / 通义 / 硅基流动 / vLLM',
  'openai-responses': 'OpenAI Responses API — 新一代 /v1/responses',
  'anthropic-messages': 'Anthropic Messages — Claude 官方协议',
  'gemini-generate': 'Google Gemini — generateContent',
};

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

  const isLocal = config.accessMode === 'local';

  // 切换接入方式
  const handleAccessModeChange = (mode: AccessMode) => {
    setModelList([]);
    setFetchError(null);
    setTestResult(null);

    if (mode === 'local') {
      setConfig({
        ...config,
        accessMode: 'local',
        baseUrl: config.baseUrl?.startsWith('http://127.0.0.1') ||
          config.baseUrl?.startsWith('http://localhost')
          ? config.baseUrl
          : 'http://127.0.0.1:8000/v1',
        dataPolicy: 'device-only',
        deploymentLocation: 'loopback',
        processingLocation: 'local',
      });
    } else {
      const preset = PROTOCOL_PRESETS[config.protocol] || PROTOCOL_PRESETS['openai-chat'];
      setConfig({
        ...config,
        accessMode: 'api',
        protocol: (PROTOCOL_PRESETS[config.protocol] ? config.protocol : 'openai-chat') as TranslationProtocol,
        baseUrl: preset.baseUrl,
        model: config.model || preset.model,
        dataPolicy: preset.policy,
        deploymentLocation: 'cloud',
        processingLocation: 'cloud',
        auth: { ...config.auth, type: preset.authType },
      });
    }
  };

  // 切换 API 协议
  const handleProtocolChange = (proto: string) => {
    const preset = PROTOCOL_PRESETS[proto];
    setModelList([]);
    setFetchError(null);
    setTestResult(null);
    setConfig({
      ...config,
      protocol: proto as TranslationProtocol,
      baseUrl: preset.baseUrl,
      model: preset.model,
      dataPolicy: preset.policy,
      auth: { ...config.auth, type: preset.authType },
    });
  };

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

  const inputClass =
    'mt-1.5 block w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 transition-all';
  const monoInputClass = `${inputClass} font-mono`;

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            {initialConfig.name ? '编辑接入配置' : '新增接入配置'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            仅支持两种接入方式：本地接入 与 API 接入
          </p>
        </div>
        <span className="font-mono text-[11px] text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
          ID: {config.profileId}
        </span>
      </div>

      <div className="space-y-4">
        {/* 1. 基础配置：名称 + 接入方式 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700">配置名称</label>
            <input
              type="text"
              className={inputClass}
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              placeholder="例如：DeepSeek 官方 / 实验室网关"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">接入方式</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(['local', 'api'] as AccessMode[]).map((mode) => {
                const active = config.accessMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleAccessModeChange(mode)}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition-all cursor-pointer ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20'
                        : 'border-slate-300 bg-slate-50/50 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {mode === 'local' ? '本地接入' : 'API 接入'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 本地接入说明 */}
        {isLocal && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 text-xs text-amber-900 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Info className="h-4 w-4 text-amber-600" />
              <span>本地接入的底层适配尚未提供</span>
            </div>
            <p className="text-[11px] text-amber-800/90 leading-relaxed">
              本版本仅提供本地接入的配置入口，尚未实现底层引擎适配，实际翻译会明确返回
              <code className="mx-auto bg-white/70 px-1 rounded font-mono">MODEL_UNAVAILABLE</code>
              ，不会静默回退到任何云端服务。请先使用「API 接入」。
            </p>
          </div>
        )}

        {/* 2. API 接入：协议选择 */}
        {!isLocal && (
          <div>
            <label className="block text-xs font-semibold text-slate-700">API 协议</label>
            <select
              className={`${inputClass} cursor-pointer`}
              value={String(config.protocol)}
              onChange={(e) => handleProtocolChange(e.target.value)}
            >
              {Object.keys(PROTOCOL_PRESETS).map((proto) => (
                <option key={proto} value={proto}>
                  {PROTOCOL_LABELS[proto]}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 3. 端点与密钥 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <LinkIcon className="h-3.5 w-3.5 text-blue-600" />
              <span>API 根地址 (BaseUrl)</span>
            </label>
            <input
              type="text"
              className={monoInputClass}
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Key className="h-3.5 w-3.5 text-amber-500" />
              <span>API 密钥 (API Key)</span>
            </label>
            <input
              type="password"
              className={monoInputClass}
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

        {/* 4. 模型获取与选择 */}
        <div className="rounded-xl bg-slate-50/80 p-4 border border-slate-100 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Cpu className="h-3.5 w-3.5 text-indigo-600" />
              <span>模型 (Model)</span>
            </label>

            <button
              type="button"
              onClick={handleFetchModels}
              disabled={fetchingModels}
              className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className={`h-3 w-3 ${fetchingModels ? 'animate-bounce' : ''}`} />
              <span>{fetchingModels ? '正在拉取...' : '获取可用模型 ⚡'}</span>
            </button>
          </div>

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
                <span className="text-emerald-700 font-medium">
                  ✓ 已获取到 {modelList.length} 个模型
                </span>
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
              placeholder="例如 deepseek-chat, gpt-4o-mini, claude-3-5-sonnet-20241022"
            />
          )}

          {fetchError && <p className="text-[11px] text-rose-600 font-medium">{fetchError}</p>}
        </div>
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
