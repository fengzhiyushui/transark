import React, { useEffect, useState } from 'react';
import { Header } from '../../src/components/Header';
import { ConfigForm } from '../../src/components/ConfigForm';
import { PolicyBadge, ProtocolBadge } from '../../src/components/StatusBadge';
import { VideoSubtitlePlayer } from '../../src/components/SubtitleOverlay';
import {
  fetchSettings,
  updateSettings,
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
} from 'lucide-react';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [activeTab, setActiveTab] = useState<'providers' | 'general' | 'subtitles'>('providers');
  const [editingProfile, setEditingProfile] = useState<TranslationProviderConfig | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [saveToast, setSaveToast] = useState(false);

  useEffect(() => {
    fetchSettings().then(setSettings);
  }, []);

  const triggerToast = () => {
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  };

  const handleSaveProfile = async (profile: TranslationProviderConfig) => {
    if (!settings) return;
    const existingIndex = settings.profiles.findIndex((p) => p.profileId === profile.profileId);
    let updatedProfiles = [...settings.profiles];

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

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">
        正在载入配置中心...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header subtitle="服务配置、协议适配与偏好设置中心" />

      {/* 提示消息浮层 */}
      {saveToast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg animate-bounce">
          <CheckCircle className="h-4 w-4" />
          <span>配置已成功保存并同步！</span>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* 顶部标签页切换 */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
          <button
            onClick={() => {
              setActiveTab('providers');
              setEditingProfile(null);
              setIsCreatingNew(false);
            }}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'providers'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            <span>翻译服务与模型配置 ({settings.profiles.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'general'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Sliders className="h-4 w-4" />
            <span>常规偏好与模拟延迟</span>
          </button>
          <button
            onClick={() => setActiveTab('subtitles')}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'subtitles'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Video className="h-4 w-4" />
            <span>视频双语字幕预览</span>
          </button>
        </div>

        {/* 1. 服务与模型配置面板 */}
        {activeTab === 'providers' && (
          <div className="mt-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">服务驱动配置列表</h2>
                <p className="text-xs text-slate-500">
                  支持本地模拟 (Mock)、本地 Ollama、OpenAI 兼容协议与自定义网关
                </p>
              </div>

              {!isCreatingNew && !editingProfile && (
                <button
                  onClick={() => {
                    setIsCreatingNew(true);
                    setEditingProfile({
                      profileId: `profile-${Date.now()}`,
                      revision: 1,
                      name: '自定义服务',
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
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>添加新服务</span>
                </button>
              )}
            </div>

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
                return (
                  <div
                    key={p.profileId}
                    className={`relative flex flex-col justify-between rounded-xl border p-4 transition-all bg-white ${
                      isActive
                        ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <h3 className="text-xs font-bold text-slate-800">{p.name}</h3>
                          <span className="font-mono text-[10px] text-slate-400">
                            {p.profileId}
                          </span>
                        </div>
                        <PolicyBadge policy={p.dataPolicy} />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-600">
                        <ProtocolBadge protocol={p.protocol} />
                        <span className="font-mono text-[11px] bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                          {p.model}
                        </span>
                      </div>

                      <div className="truncate font-mono text-[11px] text-slate-500 bg-slate-50 px-2.5 py-1 rounded">
                        {p.baseUrl}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                      <div className="flex items-center gap-2">
                        {isActive ? (
                          <span className="flex items-center gap-1 text-xs font-semibold text-blue-600">
                            <Check className="h-3.5 w-3.5" />
                            <span>当前活跃</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSetActive(p.profileId)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                          >
                            设为默认
                          </button>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          setEditingProfile(p);
                          setIsCreatingNew(false);
                        }}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        <span>配置详情</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. 常规偏好面板 */}
        {activeTab === 'general' && (
          <div className="mt-6 max-w-2xl space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
            <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">
              全局阅读与性能偏好
            </h2>

            <div className="space-y-4">
              {/* 默认目标语言 */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  默认目标语言
                </label>
                <select
                  value={settings.targetLanguage}
                  onChange={async (e) => {
                    const updated = await updateSettings({ targetLanguage: e.target.value });
                    setSettings(updated);
                    triggerToast();
                  }}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="zh-CN">简体中文 (zh-CN)</option>
                  <option value="zh-TW">繁体中文 (zh-TW)</option>
                  <option value="en">English (en)</option>
                  <option value="ja">日本語 (ja)</option>
                  <option value="ko">한국어 (ko)</option>
                </select>
              </div>

              {/* 模拟延迟 (Mock 模式专用) */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">
                    本地 Mock 模拟往返延迟 (ms)
                  </label>
                  <span className="font-mono text-xs text-blue-600 font-semibold">
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
                  className="mt-2 w-full accent-blue-600"
                />
                <p className="mt-1 text-xs text-slate-400">
                  设为 0 时瞬间返回译文；设为 100-300ms 可模拟真实网络或本地 GPU 推理延时。
                </p>
              </div>

              {/* 自动翻译开关 */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-slate-800">打开页面时自动翻译</span>
                  <p className="text-xs text-slate-500">
                    页面加载完成后自动触发段落识别与调度
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
                  className="h-4 w-4 rounded accent-blue-600"
                />
              </div>
            </div>
          </div>
        )}

        {/* 3. 视频字幕预览面板 */}
        {activeTab === 'subtitles' && (
          <div className="mt-6 space-y-4">
            <VideoSubtitlePlayer />
          </div>
        )}
      </main>
    </div>
  );
};
