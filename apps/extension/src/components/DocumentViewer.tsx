import React, { useState } from 'react';
import type { ParsedDocumentParagraph } from '../utils/docx-parser';
import { requestTranslation } from '../messaging/client';
import {
  Play,
  RotateCcw,
  Copy,
  Download,
  Search,
  Columns,
  Rows,
  Check,
  Languages,
} from 'lucide-react';

interface DocumentViewerProps {
  filename: string;
  paragraphs: ParsedDocumentParagraph[];
  targetLanguage: string;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  filename,
  paragraphs: initialParas,
  targetLanguage,
}) => {
  const [paras, setParas] = useState<ParsedDocumentParagraph[]>(initialParas);
  const [layoutMode, setLayoutMode] = useState<'side-by-side' | 'interlinear'>('side-by-side');
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: initialParas.length });
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 批量翻译全部段落
  const handleTranslateAll = async () => {
    setIsTranslating(true);
    const BATCH_SIZE = 10;
    const updated = [...paras];

    for (let i = 0; i < updated.length; i += BATCH_SIZE) {
      const slice = updated.slice(i, i + BATCH_SIZE);
      const req = {
        requestId: `doc-req-${Date.now()}-${i}`,
        sourceLanguage: 'auto',
        targetLanguage,
        segments: slice.map((p) => ({ id: p.id, text: p.originalText })),
      };

      try {
        const res = await requestTranslation(req);
        const map = new Map(res.segments.map((s) => [s.id, s.translation]));
        for (let j = i; j < i + slice.length; j++) {
          const t = map.get(updated[j].id);
          if (t) updated[j].translatedText = t;
        }
        setParas([...updated]);
        setProgress({ current: Math.min(i + BATCH_SIZE, updated.length), total: updated.length });
      } catch (err) {
        console.error('Translation error in batch:', err);
      }
    }

    setIsTranslating(false);
  };

  // 单段重新翻译
  const handleTranslateSingle = async (index: number) => {
    const p = paras[index];
    const req = {
      requestId: `single-${p.id}-${Date.now()}`,
      sourceLanguage: 'auto',
      targetLanguage,
      segments: [{ id: p.id, text: p.originalText }],
    };

    try {
      const res = await requestTranslation(req);
      if (res.segments[0]) {
        const next = [...paras];
        next[index].translatedText = res.segments[0].translation;
        setParas(next);
      }
    } catch (err) {
      console.error('Single segment error:', err);
    }
  };

  // 复制译文
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  // 导出双语文本
  const handleExport = () => {
    let output = `# ${filename} - 双语对照\n\n`;
    for (const p of paras) {
      output += `[原文] ${p.originalText}\n`;
      if (p.translatedText) {
        output += `[译文] ${p.translatedText}\n\n`;
      } else {
        output += `\n`;
      }
    }

    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bilingual_${filename}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredParas = paras.filter(
    (p) =>
      p.originalText.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.translatedText && p.translatedText.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const completedCount = paras.filter((p) => Boolean(p.translatedText)).length;

  return (
    <div className="flex flex-col h-full rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-800">{filename}</h2>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {completedCount} / {paras.length} 段已译
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索段落..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-36 rounded-lg border border-slate-200 bg-white py-1 pl-8 pr-2 text-xs focus:border-blue-500 focus:outline-hidden focus:w-48 transition-all"
            />
          </div>

          {/* 布局切换 */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setLayoutMode('side-by-side')}
              title="左右分栏对照"
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                layoutMode === 'side-by-side'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Columns className="h-3.5 w-3.5" />
              <span>左右</span>
            </button>
            <button
              onClick={() => setLayoutMode('interlinear')}
              title="上下逐段对照"
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                layoutMode === 'interlinear'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Rows className="h-3.5 w-3.5" />
              <span>上下</span>
            </button>
          </div>

          {/* 翻译按钮 */}
          <button
            onClick={handleTranslateAll}
            disabled={isTranslating}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            <Play className={`h-3 w-3 ${isTranslating ? 'animate-spin' : ''}`} />
            <span>{isTranslating ? '正在翻译...' : '翻译全篇'}</span>
          </button>

          {/* 导出按钮 */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-slate-500" />
            <span>导出</span>
          </button>
        </div>
      </div>

      {/* 翻译进度条 */}
      {isTranslating && (
        <div className="h-1 w-full bg-blue-100">
          <div
            className="h-1 bg-blue-600 transition-all duration-300"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
      )}

      {/* 段落列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredParas.map((p, idx) => {
          return (
            <div
              key={p.id}
              className="group relative rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 transition-colors"
            >
              {layoutMode === 'side-by-side' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 原文 */}
                  <div className="text-xs text-slate-800 leading-relaxed font-sans">
                    <span className="font-mono text-[10px] text-slate-400 mr-2">#{idx + 1}</span>
                    {p.originalText}
                  </div>

                  {/* 译文 */}
                  <div className="relative text-xs text-blue-900 leading-relaxed font-sans pl-3 border-l-2 border-blue-400 bg-blue-50/40 p-2 rounded-r-md">
                    {p.translatedText ? (
                      <div>{p.translatedText}</div>
                    ) : (
                      <span className="text-slate-400 italic">未翻译</span>
                    )}

                    {/* 快捷操作 */}
                    <div className="mt-2 flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {p.translatedText && (
                        <button
                          onClick={() => handleCopy(p.id, p.translatedText!)}
                          title="复制译文"
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-white transition-colors"
                        >
                          {copiedId === p.id ? (
                            <Check className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedId === p.id ? '已复制' : '复制'}</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleTranslateSingle(idx)}
                        title="单段重新翻译"
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-white transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>重译</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* 上下逐段对照 */
                <div className="space-y-2">
                  <div className="text-xs text-slate-800 leading-relaxed">
                    <span className="font-mono text-[10px] text-slate-400 mr-2">#{idx + 1}</span>
                    {p.originalText}
                  </div>

                  <div className="rounded-md border-l-3 border-blue-500 bg-blue-50/60 p-2.5 text-xs text-blue-900 leading-relaxed flex items-start justify-between">
                    <div>
                      {p.translatedText ? (
                        p.translatedText
                      ) : (
                        <span className="text-slate-400 italic">未翻译</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-3 shrink-0">
                      {p.translatedText && (
                        <button
                          onClick={() => handleCopy(p.id, p.translatedText!)}
                          className="p-1 text-slate-500 hover:text-slate-800 rounded"
                          title="复制译文"
                        >
                          {copiedId === p.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleTranslateSingle(idx)}
                        className="p-1 text-blue-600 hover:text-blue-800 rounded"
                        title="重译段落"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
