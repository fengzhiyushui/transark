import React, { useState } from 'react';
import type {
  TranslationProviderConfig,
  DataPolicy,
  TranslationProtocol,
  AuthType,
} from '@translate/contracts';
import { testProviderConnection } from '../messaging/client';
import { CheckCircle2, AlertCircle, RefreshCw, Key, Link as LinkIcon, Cpu } from 'lucide-react';

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
        error: err?.message || '连接测试失败',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-sm font-semibold text-slate-800">
          {config.profileId ? '编辑服务配置' : '新增服务配置'}
        </h3>
        <span className="text-xs font-mono text-slate-400">ID: {config.profileId}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 服务名称 */}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-700">服务名称</label>
          <input
            type="text"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            value={config.name}
            onChange={(e) => setConfig({ ...config, name: e.target.value })}
            placeholder="例如：本地 Ollama Qwen 2.5"
          />
        </div>

        {/* 协议类型 */}
        <div>
          <label className="block text-xs font-medium text-slate-700">协议与驱动</label>
          <select
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            value={config.protocol}
            onChange={(e) =>
              setConfig({
                ...config,
                protocol: e.target.value as TranslationProtocol,
              })
            }
          >
            <option value="mock">mock (内置离线模拟 - 开发与演示)</option>
            <option value="ollama">ollama (Ollama 原生 /api/chat)</option>
            <option value="openai-chat">openai-chat (OpenAI ChatCompletions 兼容)</option>
            <option value="custom-translate">custom-translate (专用翻译 JSON 服务)</option>
          </select>
        </div>

        {/* 数据策略 */}
        <div>
          <label className="block text-xs font-medium text-slate-700">数据隐私策略</label>
          <select
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            value={config.dataPolicy}
            onChange={(e) =>
              setConfig({
                ...config,
                dataPolicy: e.target.value as DataPolicy,
              })
            }
          >
            <option value="device-only">device-only (严禁公网，严格本地)</option>
            <option value="allow-lan">allow-lan (允许局域网内部调用)</option>
            <option value="allow-cloud">allow-cloud (允许外部公网云端)</option>
          </select>
        </div>

        {/* Base URL */}
        <div className="sm:col-span-2">
          <label className="flex items-center gap-1 text-xs font-medium text-slate-700">
            <LinkIcon className="h-3.5 w-3.5 text-slate-400" />
            <span>API 根地址 (BaseUrl)</span>
          </label>
          <input
            type="text"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            placeholder="http://127.0.0.1:11434 或 https://api.openai.com/v1"
          />
          <p className="mt-1 text-xs text-slate-500">
            自动匹配对应路径，如 /api/chat 或 /chat/completions。
          </p>
        </div>

        {/* Model ID */}
        <div>
          <label className="flex items-center gap-1 text-xs font-medium text-slate-700">
            <Cpu className="h-3.5 w-3.5 text-slate-400" />
            <span>模型标识 (Model)</span>
          </label>
          <input
            type="text"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            placeholder="qwen2.5:7b, gpt-4o-mini 等"
          />
        </div>

        {/* 鉴权类型 */}
        <div>
          <label className="block text-xs font-medium text-slate-700">鉴权方案</label>
          <select
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
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
            <option value="none">none (无鉴权，如本地 Ollama)</option>
            <option value="bearer">bearer (Bearer Token)</option>
            <option value="api-key">api-key (API Key Header)</option>
          </select>
        </div>

        {/* API Key / Token 输入 */}
        {config.auth?.type !== 'none' && (
          <div className="sm:col-span-2">
            <label className="flex items-center gap-1 text-xs font-medium text-slate-700">
              <Key className="h-3.5 w-3.5 text-slate-400" />
              <span>密钥凭据 (API Key / Token)</span>
            </label>
            <input
              type="password"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
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

      {/* 测试连通性反馈 */}
      {testResult && (
        <div
          className={`flex items-start gap-2.5 rounded-lg p-3 text-xs ${
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
            <p className="font-semibold">
              {testResult.success
                ? `连通性测试通过 (${testResult.durationMs}ms)`
                : '服务连接失败'}
            </p>
            {testResult.sampleTranslation && (
              <p className="text-emerald-700">
                测试译文："{testResult.sampleTranslation}"
              </p>
            )}
            {testResult.error && <p className="text-rose-700">{testResult.error}</p>}
          </div>
        </div>
      )}

      {/* 底部按钮区 */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
          <span>{testing ? '测试中...' : '测试连通性'}</span>
        </button>

        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(config.profileId)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
            >
              删除
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              取消
            </button>
          )}
          <button
            type="button"
            onClick={() => onSave(config)}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 transition-colors"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
};
