import React, { useEffect, useState } from 'react';
import { Header } from '../../src/components/Header';
import { ConfigForm } from '../../src/components/ConfigForm';
import { PolicyBadge, ProtocolBadge } from '../../src/components/StatusBadge';
import { VideoSubtitlePlayer } from '../../src/components/SubtitleOverlay';
import {
  fetchSettings,
  updateSettings,
  testProviderConnection,
} from '../../src/messaging/client';
import type { ExtensionSettings } from '../../src/storage/extension-storage';
import type { TranslationProviderConfig } from '@translate/contracts';
import {
  Sparkles,
  Plus,
  Edit2,
  Check,
  Shield,
  Video,
  Languages,
  Sliders,
  CheckCircle,
  ExternalLink,
  Zap,
  HardDrive,
  Cpu,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Lock,
  Globe,
  Radio,
} from 'lucide-react';

const PRESET_TEMPLATES: {
  title: string;
  desc: string;
  config: TranslationProviderConfig;
}[] = [
  {
    title: 'OpenAI 兼容协议 (DeepSeek / 本地)',
    desc: '支持 DeepSeek、OpenAI、月之暗面及本地 Ollama/网关',
    config: {
      profileId: 'openai-compatible-preset',
      revision: 1,
      name: 'OpenAI 兼容通用大模型',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      auth: { type: 'bearer', apiKey: '' },
      dataPolicy: 'allow-cloud',
      capabilities: { textTranslation: true, ocr: false, asr: false },
    },
  },
  {
    title: 'Claude 官方协议 (Anthropic)',
    desc: 'Anthropic Claude Messages 官方 API 接口',
    config: {
      profileId: 'claude-official-preset',
      revision: 1,
      name: 'Claude 官方模型 (Anthropic)',
      protocol: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-20241022',
      auth: { type: 'api-key', apiKey: '' },
      dataPolicy: 'allow-cloud',
      capabilities: { textTranslation: true, ocr: false, asr: false },
    },
  },
  {
    title: 'Chrome 浏览器端侧翻译 (内置)',
    desc: 'Chrome 128+ 实验性端侧 NPU/CPU 翻译，免配 0 延迟',
    config: {
      profileId: 'chrome-builtin-preset',
      revision: 1,
      name: 'Chrome 浏览器端侧原生翻译',
      protocol: 'chrome-builtin' as any,
      baseUrl: 'chrome://builtin',
      model: 'chrome-on-device-translator',
      auth: { type: 'none' },
      dataPolicy: 'device-only',
      capabilities: { textTranslation: true, ocr: false, asr: false },
    },
  },
  {
    title: '内置极速模拟 (Offline Mock)',
    desc: '无需任何外部依赖与显卡，瞬间返回拟真双语译文',
    config: {
      profileId: 'mock-offline-fast',
      revision: 1,
      name: '离线极速模拟驱动 (Mock)',
      protocol: 'mock',
      baseUrl: 'internal://mock',
      model: 'mock-engine-v1',
      auth: { type: 'none' },
      dataPolicy: 'device-only',
      capabilities: { textTranslation: true, ocr: false, asr: false },
    },
  },
];

export const App: React.FC = () => {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [activeTab, setActiveTab] = useState<'providers' | 'security' | 'general' | 'subtitles'>('providers');
  const [editingProfile, setEditingProfile] = useState<TranslationProviderConfig | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const [pingStates, setPingStates] = useState<
    Record<string, { loading: boolean; success?: boolean; durationMs?: number; error?: string }>
  >({});

  useEffect(() => {
    fetchSettings().then(setSettings);
  }, []);

  const triggerToast = () => {
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2200);
  };

  const handleSaveProfile = async (profile: TranslationProviderConfig) => {
    if (!settings) return;
    const existingIndex = settings.profiles.findIndex((p) => p.profileId === profile.profileId);
    const updatedProfiles = [...settings.profiles];

    if (existingIndex >= 0) {
      updatedProfiles[existingIndex] = {
        ...profile,
        revision: (profile.revision || 1) + 1,
      };
    } else {
      updatedProfiles.push({
        ...profile,
        profileId: profile.profileId || `custom-${Date.now()}`,
        revision: 1,
      });
    }

    const updated = await updateSettings({ profiles: updatedProfiles });
    setSettings(updated);
    setEditingProfile(null);
    setIsCreatingNew(false);
    triggerToast();
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!settings) return;
    const filtered = settings.profiles.filter((p) => p.profileId !== profileId);
    const newActive =
      settings.activeProfileId === profileId
        ? filtered[0]?.profileId || 'mock-offline-default'
        : settings.activeProfileId;

    const updated = await updateSettings({
      profiles: filtered,
      activeProfileId: newActive,
    });
    setSettings(updated);
    setEditingProfile(null);
    triggerToast();
  };

  const handleSetActive = async (profileId: string) => {
    if (!settings) return;
    const updated = await updateSettings({ activeProfileId: profileId });
    setSettings(updated);
    triggerToast();
  };

  const handleQuickPing = async (profile: TranslationProviderConfig) => {
    setPingStates((prev) => ({
      ...prev,
      [profile.profileId]: { loading: true },
    }));

    try {
      const res = await testProviderConnection(profile);
      setPingStates((prev) => ({
        ...prev,
        [profile.profileId]: { loading: false, success: true, durationMs: res.durationMs },
      }));
    } catch (err: any) {
      setPingStates((prev) => ({
        ...prev,
        [profile.profileId]: { loading: false, success: false, error: err?.message || '无法连接' },
      }));
    }
  };

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-xs text-slate-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span className="ml-3 font-medium">正在读取系统设置中心...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 antialiased selection:bg-blue-100 selection:text-blue-900">
      <Header
        title="译舟设置中心 · TransArk Settings"
        subtitle="独立全功能控制台 · 多协议驱动调度与本地安全审计"
      />

      {/* 提示消息浮层 */}
      {saveToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-semibold text-white shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle className="h-4 w-4 text-emerald-400" />
          <span>配置已成功保存并即刻同步！</span>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* 顶部标签页切换 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4">
          <button
            onClick={() => {
              setActiveTab('providers');
              setEditingProfile(null);
              setIsCreatingNew(false);
            }}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'providers'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            <span>翻译驱动与模型 ({settings.profiles.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'security'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
            }`}
          >
            <Shield className="h-4 w-4" />
            <span>安全与离线审计</span>
          </button>

          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'general'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
            }`}
          >
            <Sliders className="h-4 w-4" />
            <span>常规偏好与模拟延迟</span>
          </button>

          <button
            onClick={() => setActiveTab('subtitles')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'subtitles'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
            }`}
          >
            <Video className="h-4 w-4" />
            <span>视频双语字幕预览</span>
          </button>
        </div>

        {/* 1. 服务与模型配置面板 */}
        {activeTab === 'providers' && (
          <div className="mt-6 space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">翻译服务驱动列表</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  支持本地离线大模型 (Ollama)、伴随推理服务、OpenAI 兼容端点及内置 Mock
                </p>
              </div>

              {!isCreatingNew && !editingProfile && (
                <button
                  onClick={() => {
                    setIsCreatingNew(true);
                    setEditingProfile({
                      profileId: `profile-${Date.now()}`,
                      revision: 1,
                      name: '自定义翻译服务',
                      protocol: 'openai-chat',
                      baseUrl: 'http://127.0.0.1:8000/v1',
                      model: 'custom-model',
                      auth: { type: 'bearer', apiKey: '' },
                      dataPolicy: 'device-only',
                      capabilities: {
                        textTranslation: true,
                        ocr: false,
                        asr: false,
                      },
                    });
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700 active:scale-95 transition-all cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>添加新服务驱动</span>
                </button>
              )}
            </div>

            {/* 快捷模板栏 (若不在编辑状态时呈现) */}
            {!isCreatingNew && !editingProfile && (
              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span>一键预设模版快速添加</span>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {PRESET_TEMPLATES.map((tmpl) => (
                    <button
                      key={tmpl.config.profileId}
                      onClick={() => {
                        setIsCreatingNew(true);
                        setEditingProfile({
                          ...tmpl.config,
                          profileId: `${tmpl.config.profileId}-${Date.now().toString().slice(-4)}`,
                        });
                      }}
                      className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-left hover:border-blue-300 hover:bg-blue-50/40 transition-all cursor-pointer"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-800 group-hover:text-blue-700">
                          {tmpl.title}
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 leading-normal line-clamp-2">
                          {tmpl.desc}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-blue-600">
                        <span>载入模版 +</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 编辑或创建表单 */}
            {(isCreatingNew || editingProfile) && (
              <div className="animate-in fade-in duration-200">
                <ConfigForm
                  initialConfig={editingProfile!}
                  onSave={handleSaveProfile}
                  onDelete={
                    !isCreatingNew && editingProfile
                      ? () => handleDeleteProfile(editingProfile.profileId)
                      : undefined
                  }
                  onCancel={() => {
                    setEditingProfile(null);
                    setIsCreatingNew(false);
                  }}
                />
              </div>
            )}

            {/* 配置卡片网格 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {settings.profiles.map((p) => {
                const isActive = settings.activeProfileId === p.profileId;
                const ping = pingStates[p.profileId];

                return (
                  <div
                    key={p.profileId}
                    className={`relative flex flex-col justify-between rounded-2xl border p-5 transition-all bg-white ${
                      isActive
                        ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-sm'
                        : 'border-slate-200/90 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900">{p.name}</h3>
                            {isActive && (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 ring-1 ring-blue-600/20">
                                当前默认
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-slate-400">
                            {p.profileId}
                          </span>
                        </div>
                        <PolicyBadge policy={p.dataPolicy} />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <ProtocolBadge protocol={p.protocol} />
                        <span className="font-mono text-[11px] bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 text-slate-700">
                          {p.model || 'default'}
                        </span>
                      </div>

                      <div className="truncate font-mono text-[11px] text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-100/80">
                        {p.baseUrl}
                      </div>

                      {/* 快速 Ping 状态反馈 */}
                      {ping && (
                        <div className="pt-1">
                          {ping.loading && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                              <RefreshCw className="h-3 w-3 animate-spin text-blue-600" />
                              <span>连通性检测中...</span>
                            </div>
                          )}
                          {ping.success && (
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                              <span>连接正常 ({ping.durationMs}ms)</span>
                            </div>
                          )}
                          {ping.error && (
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-1 rounded-md border border-rose-200 truncate">
                              <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                              <span className="truncate">{ping.error}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3.5">
                      <div className="flex items-center gap-2">
                        {isActive ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-blue-600">
                            <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                            <span>启用中</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSetActive(p.profileId)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all cursor-pointer"
                          >
                            设为默认
                          </button>
                        )}

                        <button
                          onClick={() => handleQuickPing(p)}
                          disabled={ping?.loading}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                        >
                          <Radio className="h-3 w-3 text-slate-500" />
                          <span>测试</span>
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          setEditingProfile(p);
                          setIsCreatingNew(false);
                        }}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        <span>编辑配置</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. 安全与离线审计面板 (全新交付) */}
        {activeTab === 'security' && (
          <div className="mt-6 space-y-6">
            <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-5">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-emerald-600" />
                  <span>TransArk 隐私安全与离线边界审计</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  严格本地优先架构，杜绝商业机密与个人敏感数据非预期外泄
                </p>
              </div>

              {/* 核心安全保障卡片网格 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                    <Lock className="h-4 w-4 text-emerald-600" />
                    <span>本地回环隔离</span>
                  </div>
                  <p className="text-[11px] text-emerald-900/80 leading-relaxed">
                    在 <code className="font-mono bg-emerald-100/60 px-1 rounded">device-only</code> 策略下，扩展与伴随服务只放行本机回环网络（127.0.0.1 / ::1），任何向外网的流量请求都会被硬阻断并返回 <code className="font-mono">POLICY_VIOLATION</code>。
                  </p>
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-blue-800 font-bold text-xs">
                    <HardDrive className="h-4 w-4 text-blue-600" />
                    <span>严禁静默云端回退</span>
                  </div>
                  <p className="text-[11px] text-blue-900/80 leading-relaxed">
                    绝不在本地模型未启动或报错时偷偷转调公共商业模型接口。若离线服务不可用，明确提示错误，确保翻译操作 100% 可控、可信。
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-slate-800 font-bold text-xs">
                    <CheckCircle2 className="h-4 w-4 text-slate-600" />
                    <span>无痕 DOM 挂载</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    页面双语对照采用兄弟节点插桩方案，不破坏原网页脚本事件。关闭翻译或刷新网页时即刻完全移除，不在本地残留外传日志。
                  </p>
                </div>
              </div>

              {/* 策略对照表 */}
              <div className="pt-2">
                <h3 className="text-xs font-bold text-slate-800 mb-2">数据策略安全级别对照</h3>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-semibold">
                      <tr>
                        <th className="px-4 py-2.5 text-left">策略类型</th>
                        <th className="px-4 py-2.5 text-left">安全评级</th>
                        <th className="px-4 py-2.5 text-left">适用场景</th>
                        <th className="px-4 py-2.5 text-left">出口守卫规则</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      <tr>
                        <td className="px-4 py-3 font-semibold text-emerald-700">device-only</td>
                        <td className="px-4 py-3">⭐⭐⭐⭐⭐ 最高安全</td>
                        <td className="px-4 py-3 text-slate-600">本地 Ollama / 本地 Python 引擎 / 敏感机密文档</td>
                        <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">仅放行 127.0.0.1 及 ::1，禁止所有公网通信</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-semibold text-blue-700">allow-lan</td>
                        <td className="px-4 py-3">⭐⭐⭐⭐ 局域网内可控</td>
                        <td className="px-4 py-3 text-slate-600">公司内部私有部署 GPU 服务器</td>
                        <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">放行 RFC1918 私网网段，拦截公网外联</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-semibold text-amber-700">allow-cloud</td>
                        <td className="px-4 py-3">⭐⭐⭐ 公网商业 API</td>
                        <td className="px-4 py-3 text-slate-600">DeepSeek / OpenAI 等云端大模型服务</td>
                        <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">用户显式配置后方可发送请求至目标域名</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. 常规偏好面板 */}
        {activeTab === 'general' && (
          <div className="mt-6 max-w-2xl space-y-6 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
              全局阅读交互与性能偏好
            </h2>

            <div className="space-y-5">
              {/* 默认目标语言 */}
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  默认目标语言 (Target Language)
                </label>
                <select
                  value={settings.targetLanguage}
                  onChange={async (e) => {
                    const updated = await updateSettings({ targetLanguage: e.target.value });
                    setSettings(updated);
                    triggerToast();
                  }}
                  className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-blue-500 focus:outline-hidden cursor-pointer"
                >
                  <option value="zh-CN">简体中文 (zh-CN)</option>
                  <option value="zh-TW">繁体中文 (zh-TW)</option>
                  <option value="en">English (en)</option>
                  <option value="ja">日本語 (ja)</option>
                  <option value="ko">한국어 (ko)</option>
                  <option value="es">Español (es)</option>
                  <option value="fr">Français (fr)</option>
                  <option value="de">Deutsch (de)</option>
                </select>
              </div>

              {/* 模拟延迟 (Mock 模式专用) */}
              <div className="rounded-xl bg-slate-50/80 p-4 border border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-800">
                    内置 Mock 模拟响应延迟 (ms)
                  </label>
                  <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                    {settings.mockDelayMs} ms
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="20"
                  value={settings.mockDelayMs}
                  onChange={async (e) => {
                    const delay = parseInt(e.target.value, 10);
                    const updated = await updateSettings({ mockDelayMs: delay });
                    setSettings(updated);
                  }}
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <p className="text-[11px] text-slate-500">
                  设为 0 时模拟瞬间返回译文；设为 100-300ms 可模拟本地真实 GPU 推理延时，方便测试流式调度感。
                </p>
              </div>

              {/* 自动翻译开关 */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-800">打开页面时自动执行双语翻译</span>
                  <p className="text-[11px] text-slate-500">
                    页面加载完成后自动触发段落识别与调度队列
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoTranslate}
                  onChange={async (e) => {
                    const updated = await updateSettings({ autoTranslate: e.target.checked });
                    setSettings(updated);
                    triggerToast();
                  }}
                  className="h-4 w-4 rounded accent-blue-600 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {/* 4. 视频字幕预览面板 */}
        {activeTab === 'subtitles' && (
          <div className="mt-6 space-y-4">
            <VideoSubtitlePlayer />
          </div>
        )}
      </main>
    </div>
  );
};
