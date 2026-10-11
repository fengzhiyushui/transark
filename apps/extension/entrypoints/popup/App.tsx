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
import {
  Languages,
  Power,
  RotateCcw,
  Sparkles,
  BookOpen,
  SlidersHorizontal,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
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

  const openPageInNewTab = (pagePath: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
      chrome.tabs.create({ url: chrome.runtime.getURL(pagePath) });
    } else if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage && pagePath === 'options.html') {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(pagePath, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="flex h-72 w-[360px] flex-col items-center justify-center bg-slate-50 text-xs text-slate-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span className="mt-3 font-medium">正在读取服务与页面状态...</span>
      </div>
    );
  }

  const progressPercent =
    pageStatus && pageStatus.totalSegments > 0
      ? Math.round((pageStatus.translatedSegments / pageStatus.totalSegments) * 100)
      : 0;

  return (
    <div className="flex w-[360px] min-h-[460px] flex-col bg-slate-50 text-slate-800 antialiased select-none">
      <Header />

      <div className="p-3.5 space-y-3.5">
        {/* 核心双语翻译主控卡片 */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs transition-all">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-900">网页双语对照</span>
                {translatingNow ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    生效中
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    未启用
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                {translatingNow ? '智能分块 · 视口优先无感加载' : '点击右侧按钮开启当前网页双语翻译'}
              </p>
            </div>

            <button
              onClick={handleToggleTranslation}
              title={translatingNow ? '暂停/关闭网页翻译' : '开启网页翻译'}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all duration-200 cursor-pointer active:scale-95 ${
                translatingNow
                  ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30 ring-2 ring-blue-500/20'
                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
              }`}
            >
              <Power className={`h-5 w-5 ${translatingNow ? 'stroke-[2.5]' : ''}`} />
            </button>
          </div>

          {/* 进度条与翻译段落状态 */}
          {pageStatus && pageStatus.totalSegments > 0 && (
            <div className="mt-3.5 pt-3 border-t border-slate-100/80 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-medium text-slate-500">翻译进度</span>
                <span className="font-mono text-[11px] font-semibold text-slate-800">
                  {pageStatus.translatedSegments} / {pageStatus.totalSegments} 段 ({progressPercent}%)
                </span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* 撤销 / 隐藏译文 */}
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleRevert}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>一键隐藏译文 (恢复纯净原文)</span>
                </button>
                {pageStatus.isReverted && (
                  <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                    已切换原文
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 目标语言设置卡片 */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Languages className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-slate-800">目标语言</span>
            </div>
            <select
              value={settings?.targetLanguage || 'zh-CN'}
              onChange={(e) => handleSelectTargetLang(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-hidden cursor-pointer hover:bg-slate-100 transition-colors"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 当前翻译引擎与驱动卡片 */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-slate-800">当前驱动引擎</span>
            </div>
            <select
              value={settings?.activeProfileId}
              onChange={(e) => handleSelectProfile(e.target.value)}
              className="max-w-[180px] truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-hidden cursor-pointer hover:bg-slate-100 transition-colors"
            >
              {settings?.profiles.map((p) => (
                <option key={p.profileId} value={p.profileId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {activeProfile && (
            <div className="rounded-xl bg-slate-50/80 p-2.5 space-y-1.5 border border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700 truncate max-w-[160px]">
                  {activeProfile.name}
                </span>
                <PolicyBadge policy={activeProfile.dataPolicy} />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <div className="flex items-center gap-1.5 font-mono">
                  <ProtocolBadge protocol={activeProfile.protocol} />
                  <span className="truncate max-w-[120px]">{activeProfile.model || 'default'}</span>
                </div>
                <button
                  onClick={() => openPageInNewTab('options.html')}
                  className="flex items-center gap-0.5 text-blue-600 hover:text-blue-800 transition-colors font-medium cursor-pointer"
                >
                  <span>配置 ↗</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 底部独立页面快捷入口 (按用户要求显式打开新页面) */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button
            onClick={() => openPageInNewTab('reader.html')}
            className="group flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-3 text-left shadow-2xs hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <BookOpen className="h-3.5 w-3.5" />
              </div>
              <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-blue-600 opacity-70" />
            </div>
            <div className="mt-2.5">
              <div className="text-xs font-semibold text-slate-800">本地阅读器</div>
              <p className="text-[10px] text-slate-500 mt-0.5">新标签页打开文档</p>
            </div>
          </button>

          <button
            onClick={() => openPageInNewTab('options.html')}
            className="group flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-3 text-left shadow-2xs hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </div>
              <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-blue-600 opacity-70" />
            </div>
            <div className="mt-2.5">
              <div className="text-xs font-semibold text-slate-800">完整设置中心</div>
              <p className="text-[10px] text-slate-500 mt-0.5">新标签页打开控制台</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
