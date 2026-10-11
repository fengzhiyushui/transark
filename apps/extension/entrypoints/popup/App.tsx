import React, { useEffect, useState } from 'react';
import { Header } from '../../src/components/Header';
import { PolicyBadge, ProtocolBadge } from '../../src/components/StatusBadge';
import {
  fetchSettings,
  updateSettings,
  queryCurrentPageStatus,
  toggleCurrentPageTranslation,
  getActiveTabId,
  sendMessageToTab,
} from '../../src/messaging/client';
import type { ExtensionSettings } from '../../src/storage/extension-storage';
import type { PageTranslationStatus } from '../../src/messaging/protocol';
import type { TranslationProviderConfig } from '@translate/contracts';
import {
  Languages,
  Power,
  RotateCcw,
  Sparkles,
  Layers,
  ChevronRight,
  SlidersHorizontal,
  ExternalLink,
} from 'lucide-react';

const LANGUAGE_OPTIONS = [
  { code: 'zh-CN', label: '简体中文 (zh-CN)' },
  { code: 'zh-TW', label: '繁体中文 (zh-TW)' },
  { code: 'en', label: 'English (en)' },
  { code: 'ja', label: '日本語 (ja)' },
  { code: 'ko', label: '한국어 (ko)' },
  { code: 'es', label: 'Español (es)' },
  { code: 'fr', label: 'Français (fr)' },
  { code: 'de', label: 'Deutsch (de)' },
];

export const App: React.FC = () => {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [pageStatus, setPageStatus] = useState<PageTranslationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [translatingNow, setTranslatingNow] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const s = await fetchSettings();
        setSettings(s);
        const status = await queryCurrentPageStatus();
        setPageStatus(status);
        if (status) {
          setTranslatingNow(status.isTranslating && !status.isReverted);
        }
      } catch (err) {
        console.error('Failed to init popup:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const activeProfile = settings?.profiles.find(
    (p) => p.profileId === settings.activeProfileId
  ) || settings?.profiles[0];

  const handleToggleTranslation = async () => {
    if (!settings) return;
    const nextState = !translatingNow;
    setTranslatingNow(nextState);

    await toggleCurrentPageTranslation(nextState, settings.targetLanguage);

    // 重新获取页面状态
    setTimeout(async () => {
      const status = await queryCurrentPageStatus();
      setPageStatus(status);
    }, 300);
  };

  const handleRevert = async () => {
    const tabId = await getActiveTabId();
    if (tabId) {
      await sendMessageToTab(tabId, { type: 'RESTORE_PAGE_ORIGINAL' });
      setTranslatingNow(false);
      const status = await queryCurrentPageStatus();
      setPageStatus(status);
    }
  };

  const handleSelectProfile = async (profileId: string) => {
    if (!settings) return;
    const updated = await updateSettings({ activeProfileId: profileId });
    setSettings(updated);
  };

  const handleSelectTargetLang = async (lang: string) => {
    if (!settings) return;
    const updated = await updateSettings({ targetLanguage: lang });
    setSettings(updated);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center bg-white text-xs text-slate-500">
        正在载入配置与页面状态...
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-slate-50 text-slate-800">
      <Header />

      <div className="p-4 space-y-4">
        {/* 核心翻译大开关 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-slate-900">网页双语对照</span>
              <p className="text-[11px] text-slate-500">
                {translatingNow ? '双语翻译已启用，段落按视口优先挂载' : '点击开启当前页面双语翻译'}
              </p>
            </div>
            <button
              onClick={handleToggleTranslation}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
                translatingNow
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 ring-2 ring-blue-500/30'
                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
              }`}
            >
              <Power className="h-4 w-4" />
            </button>
          </div>

          {/* 页面翻译进度与统计 */}
          {pageStatus && pageStatus.totalSegments > 0 && (
            <div className="mt-3.5 pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">处理进度</span>
                <span className="font-semibold text-slate-800">
                  {pageStatus.translatedSegments} / {pageStatus.totalSegments} 段
                </span>
              </div>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-300"
                  style={{
                    width: `${
                      (pageStatus.translatedSegments / pageStatus.totalSegments) * 100
                    }%`,
                  }}
                />
              </div>

              {/* 撤销恢复快捷按钮 */}
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleRevert}
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>一键隐藏译文 (恢复原文)</span>
                </button>
                {pageStatus.isReverted && (
                  <span className="text-[10px] text-amber-600 font-medium">已隐藏</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 目标语言设置 */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
              <Languages className="h-3.5 w-3.5 text-blue-600" />
              <span>目标语言</span>
            </label>
            <select
              value={settings?.targetLanguage || 'zh-CN'}
              onChange={(e) => handleSelectTargetLang(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-hidden"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 当前服务配置 Profile 卡片 */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span>翻译引擎与驱动</span>
            </span>
            <select
              value={settings?.activeProfileId}
              onChange={(e) => handleSelectProfile(e.target.value)}
              className="max-w-[190px] truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-hidden"
            >
              {settings?.profiles.map((p) => (
                <option key={p.profileId} value={p.profileId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {activeProfile && (
            <div className="rounded-lg bg-slate-50 p-2.5 space-y-1.5 border border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-600 truncate max-w-[170px]">
                  {activeProfile.name}
                </span>
                <PolicyBadge policy={activeProfile.dataPolicy} />
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                <ProtocolBadge protocol={activeProfile.protocol} />
                <span className="truncate">{activeProfile.model || 'default'}</span>
              </div>
            </div>
          )}
        </div>

        {/* 底部常用工具与入口 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
                window.open(chrome.runtime.getURL('reader.html'), '_blank');
              } else {
                window.open('reader.html', '_blank');
              }
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <Layers className="h-3.5 w-3.5 text-blue-600" />
            <span>本地文件阅读器</span>
          </button>
          <button
            onClick={() => {
              if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
                chrome.runtime.openOptionsPage();
              } else {
                window.open('options.html', '_blank');
              }
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-600" />
            <span>设置中心</span>
          </button>
        </div>
      </div>
    </div>
  );
};
