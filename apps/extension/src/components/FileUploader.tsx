import React, { useRef, useState } from 'react';
import { UploadCloud, FileText, CheckCircle2 } from 'lucide-react';
import { parseDocxFile, parseTxtFile, type ParsedDocumentParagraph } from '../utils/docx-parser';

interface FileUploaderProps {
  onLoaded: (filename: string, paragraphs: ParsedDocumentParagraph[]) => void;
  onError: (err: string) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onLoaded, onError }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setIsLoading(true);
    try {
      const name = file.name.toLowerCase();
      let paras: ParsedDocumentParagraph[] = [];

      if (name.endsWith('.docx')) {
        paras = await parseDocxFile(file);
      } else if (name.endsWith('.txt') || name.endsWith('.md')) {
        paras = await parseTxtFile(file);
      } else {
        throw new Error('仅支持 .txt, .md 或 .docx 格式文档');
      }

      if (paras.length === 0) {
        throw new Error('文档中未解析到有效段落内容');
      }

      onLoaded(file.name, paras);
    } catch (err: any) {
      onError(err?.message || '读取文件失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all ${
        isDragging
          ? 'border-blue-500 bg-blue-50/50'
          : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50/50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.docx,.md"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
          }
        }}
      />

      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 group-hover:scale-105 transition-transform">
        <UploadCloud className="h-6 w-6" />
      </div>

      <h3 className="mt-3 text-sm font-semibold text-slate-800">
        {isLoading ? '正在解析文档结构...' : '点击或拖拽文件至此处'}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        支持 TXT、Markdown 与 DOCX 原生文档对照阅读与分段翻译
      </p>

      <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" /> .txt / .md
        </span>
        <span className="h-1 w-1 rounded-full bg-slate-300" />
        <span className="flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" /> .docx
        </span>
        <span className="h-1 w-1 rounded-full bg-slate-300" />
        <span className="flex items-center gap-1 text-emerald-600 font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" /> 纯前端离线解析
        </span>
      </div>
    </div>
  );
};
