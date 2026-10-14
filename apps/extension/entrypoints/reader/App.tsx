import React, { useEffect, useState } from 'react';
import { Header } from '../../src/components/Header';
import { FileUploader } from '../../src/components/FileUploader';
import { DocumentViewer } from '../../src/components/DocumentViewer';
import { VideoSubtitlePlayer } from '../../src/components/SubtitleOverlay';
import { fetchSettings } from '../../src/messaging/client';
import type { ParsedDocumentParagraph } from '../../src/utils/docx-parser';
import {
  BookOpen,
  FileText,
  Upload,
  Video,
  Sparkles,
  Info,
  Layers,
} from 'lucide-react';

const SAMPLE_DOCUMENT: ParsedDocumentParagraph[] = [
  {
    id: 'p-1',
    originalText:
      'This is a cross-platform browser translation extension built with Manifest V3 and WXT.',
    translatedText:
      '这是一个采用 Manifest V3 与 WXT 构建的跨平台浏览器翻译扩展。',
  },
  {
    id: 'p-2',
    originalText:
      'Offline translation guarantees complete data privacy by keeping all processing on-device.',
    translatedText:
      '离线翻译通过在设备本地完成所有计算处理，确保完整的数据隐私。',
  },
  {
    id: 'p-3',
    originalText:
      'Both text PDF files and scanned image documents can be parsed through reading order layout reconstruction.',
  },
  {
    id: 'p-4',
    originalText:
      'Offline document processing keeps intellectual property and sensitive corporate data within local boundaries.',
  },
  {
    id: 'p-5',
    originalText:
      'The paragraph recognition algorithm splits visible block elements and continuous inline nodes into translation units.',
  },
  {
    id: 'p-6',
    originalText:
      'A priority queue powered by IntersectionObserver ensures that elements inside the viewport are processed first.',
  },
  {
    id: 'p-7',
    originalText:
      'Bilingual DOM mounting preserves original nodes and event listeners, allowing seamless one-click revert and restore.',
  },
  {
    id: 'p-8',
    originalText:
      'Dynamic content adaptation uses MutationObserver with debouncing and self-insertion filtering to prevent infinite loops.',
  },
];

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'document' | 'video'>('document');
  const [currentFile, setCurrentFile] = useState<{
    name: string;
    paragraphs: ParsedDocumentParagraph[];
  }>({
    name: '架构技术白皮书 (示例样本)',
    paragraphs: SAMPLE_DOCUMENT,
  });
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => setTargetLang(s.targetLanguage || 'zh-CN'))
      .catch(() => {});
  }, []);

  const handleLoadedFile = (name: string, paragraphs: ParsedDocumentParagraph[]) => {
    setErrorMsg(null);
    setCurrentFile({ name, paragraphs });
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-800 antialiased overflow-hidden">
      <Header
        title="译舟工作台 · TransArk Workspace"
        subtitle="本地独立阅读器 · 零服务端中转的双语对照解析与字幕控制台"
      />

      <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
        {/* 顶部模式切换导航 */}
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('document')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'document'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
              }`}
            >
              <BookOpen className="h-4 w-4" />
              <span>本地文件双语对照阅读 (TXT / DOCX)</span>
            </button>
            <button
              onClick={() => setActiveTab('video')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'video'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
              }`}
            >
              <Video className="h-4 w-4" />
              <span>视频双语悬浮字幕容器</span>
            </button>
          </div>

          {activeTab === 'document' && (
            <button
              onClick={() => {
                setCurrentFile({
                  name: '架构技术白皮书 (示例样本)',
                  paragraphs: SAMPLE_DOCUMENT,
                });
              }}
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-semibold transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>重置为示范样本</span>
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="mb-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200 flex items-center justify-between animate-in fade-in">
            <span>{errorMsg}</span>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-rose-500 hover:text-rose-800 font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* 主工作区 */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'document' ? (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-full">
              {/* 左侧上传面板 */}
              <div className="lg:col-span-1 flex flex-col gap-3">
                <FileUploader
                  onLoaded={handleLoadedFile}
                  onError={(err) => setErrorMsg(err)}
                />

                <div className="rounded-2xl border border-slate-200/90 bg-white p-4.5 text-xs text-slate-500 space-y-2.5 shadow-xs">
                  <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                    <Info className="h-4 w-4 text-blue-600" />
                    <span>离线双语阅读特性</span>
                  </div>
                  <ul className="space-y-1.5 text-slate-600 text-[11px] leading-relaxed">
                    <li className="flex items-start gap-1.5">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>支持直接读取 DOCX、TXT 与 Markdown 文本</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>零服务端中转，全部在浏览器本地沙盒解析</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>左右分栏与上下逐段模式实时无缝切换</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-blue-500 mt-0.5">•</span>
                      <span>通过 API 接入云端大模型实现逐段双语对照</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* 右侧段落对照阅读器 */}
              <div className="lg:col-span-3 h-full overflow-hidden">
                <DocumentViewer
                  key={currentFile.name}
                  filename={currentFile.name}
                  paragraphs={currentFile.paragraphs}
                  targetLanguage={targetLang}
                />
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-2">
              <VideoSubtitlePlayer />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
