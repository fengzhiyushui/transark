import React, { useState } from 'react';
import type {
  TranslationProviderConfig,
  DataPolicy,
  TranslationProtocol,
  AuthType,
} from '@translate/contracts';
import { testProviderConnection } from '../messaging/client';
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Key,
  Link as LinkIcon,
  Cpu,
  ShieldCheck,
  Globe,
  HardDrive,
  Network,
  Info,
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
  const [testResult, setTestResult] = useState<{
    success: boolean;
    durationMs?: number;
    sampleTranslation?: string;
    error?: string;
  } | null>(null);

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

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            {config.profileId ? '编辑服务配置' : '新增服务驱动配置'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            配置用于网页双语对照及文档解析的翻译服务引擎
          </p>
        </div>
        <span className="font-mono text-[11px] text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
          ID: {config.profileId}
        </span>
      </div>

      <div className="space-y-4">
        {/* 第一组：基础属性 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700">服务名称</label>
            <input
              type="text"
              className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 transition-all"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              placeholder="例如：本地 Ollama Qwen 2.5"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">协议与驱动</label>
            <select
              className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 cursor-pointer transition-all"
              value={config.protocol}
              onChange={(e) =>
                setConfig({
                  ...config,
                  protocol: e.target.value as TranslationProtocol,
                })
              }
            >
              <option value="mock">mock (内置极速模拟 - 离线开发与基准演练)</option>
              <option value="ollama">ollama (Ollama 原生 /api/chat)</option>
              <option value="openai-chat">openai-chat (OpenAI ChatCompletions 标准兼容)</option>
              <option value="custom-translate">custom-translate (TransArk 伴随服务 /v1/translate)</option>
            </select>
          </div>
        </div>

        {/* 第二组：端点与模型 */}
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
              placeholder="http://127.0.0.1:11434 或 https://api.deepseek.com/v1"
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Cpu className="h-3.5 w-3.5 text-indigo-600" />
              <span>模型标识 (Model)</span>
            </label>
            <input
              type="text"
              className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 transition-all"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder="qwen2.5:7b, deepseek-chat, gpt-4o-mini"
            />
          </div>
        </div>

        {/* 第三组：数据隐私与鉴权策略 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-xl bg-slate-50/80 p-3.5 border border-slate-100">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              <span>数据隐私策略 (Data Policy)</span>
            </label>
            <select
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-500 focus:outline-hidden cursor-pointer"
              value={config.dataPolicy}
              onChange={(e) =>
                setConfig({
                  ...config,
                  dataPolicy: e.target.value as DataPolicy,
                })
              }
            >
              <option value="device-only">device-only (严格本地回环，禁止任何公网外联)</option>
              <option value="allow-lan">allow-lan (允许内网局域网私有化模型)</option>
              <option value="allow-cloud">allow-cloud (允许外发至公网商业 LLM)</option>
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              {config.dataPolicy === 'device-only'
                ? '🔒 出口守卫仅放行 127.0.0.1 / ::1，最高安全级别'
                : config.dataPolicy === 'allow-lan'
                ? '🏢 适合公司内部内网 GPU 服务器'
                : '🌐 文本将发往云端服务商，请确认合规性'}
            </p>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Key className="h-3.5 w-3.5 text-amber-500" />
              <span>鉴权方式 (Auth Type)</span>
            </label>
            <select
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-500 focus:outline-hidden cursor-pointer"
              value={config.auth?.type || 'none'}
              onChange={(e) =>
                setConfig({
                  ...config,
                  auth: {
                    ...config.auth,
                    type: e.target.value as AuthType,
                  },
                })
              }
            >
              <option value="none">none (无鉴权，如本地 Ollama 默认接口)</option>
              <option value="bearer">bearer (Bearer 令牌)</option>
              <option value="api-key">api-key (API Key 请求头)</option>
            </select>
          </div>

          {config.auth?.type !== 'none' && (
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">
                密钥令牌 (API Key / Token)
              </label>
              <input
                type="password"
                className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 transition-all"
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
          )}
        </div>
      </div>

      {/* 连通性测试结果反馈 */}
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
                ? `连通性测试通过！(往返耗时: ${testResult.durationMs}ms)`
                : '连通性测试失败'}
            </p>
            {testResult.sampleTranslation && (
              <p className="text-emerald-700">
                样本返回：<span className="font-semibold">"{testResult.sampleTranslation}"</span>
              </p>
            )}
            {testResult.error && <p className="text-rose-700 font-mono">{testResult.error}</p>}
          </div>
        </div>
      )}

      {/* 底部操作工具条 */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 active:scale-95 transition-all cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
          <span>{testing ? '正在检测连通性...' : '测试连通性'}</span>
        </button>

        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(config.profileId)}
              className="rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 active:scale-95 transition-all cursor-pointer"
            >
              删除配置
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
