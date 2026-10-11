import React from 'react';
import { Languages, Settings, BookOpen, ExternalLink } from 'lucide-react';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  showNav?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title = '译舟 TransArk',
  subtitle = '智能双语阅读与跨协议翻译',
  showNav = true,
}) => {
  const openOptionsPage = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    } else if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('options.html', '_blank');
    }
  };

  const openReaderPage = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
      chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') });
    } else if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      window.open(chrome.runtime.getURL('reader.html'), '_blank');
    } else {
      window.open('reader.html', '_blank');
    }
  };

  return (
    <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md sticky top-0 z-40">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-500/25 ring-1 ring-white/20">
          <Languages className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h1>
            <span className="rounded-sm bg-blue-50 px-1 py-0.2 text-[9px] font-mono font-medium text-blue-600 ring-1 ring-blue-600/10">v0.1</span>
          </div>
          {subtitle && <p className="text-[11px] text-slate-500 leading-tight">{subtitle}</p>}
        </div>
      </div>

      {showNav && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={openReaderPage}
            title="在新标签页中打开本地文档阅读器"
            className="group flex items-center gap-1 rounded-lg border border-slate-200/60 bg-slate-50/80 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-blue-200 hover:bg-blue-50/50 hover:text-blue-700 transition-all cursor-pointer"
          >
            <BookOpen className="h-3.5 w-3.5 text-slate-500 group-hover:text-blue-600 transition-colors" />
            <span>阅读器</span>
            <ExternalLink className="h-2.5 w-2.5 text-slate-400 group-hover:text-blue-500 opacity-60" />
          </button>
          <button
            onClick={openOptionsPage}
            title="在新标签页中打开设置中心"
            className="group flex items-center gap-1 rounded-lg border border-slate-200/60 bg-slate-50/80 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-blue-200 hover:bg-blue-50/50 hover:text-blue-700 transition-all cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5 text-slate-500 group-hover:text-blue-600 transition-colors" />
            <span>设置</span>
            <ExternalLink className="h-2.5 w-2.5 text-slate-400 group-hover:text-blue-500 opacity-60" />
          </button>
        </div>
      )}
    </header>
  );
};
