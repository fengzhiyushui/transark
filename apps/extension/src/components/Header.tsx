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
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('options.html', '_blank');
    }
  };

  const openReaderPage = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      window.open(chrome.runtime.getURL('reader.html'), '_blank');
    } else {
      window.open('reader.html', '_blank');
    }
  };

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-500/20">
          <Languages className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>

      {showNav && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={openReaderPage}
            title="打开本地文件阅读器"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>阅读器</span>
          </button>
          <button
            onClick={openOptionsPage}
            title="扩展设置中心"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>设置</span>
          </button>
        </div>
      )}
    </header>
  );
};
