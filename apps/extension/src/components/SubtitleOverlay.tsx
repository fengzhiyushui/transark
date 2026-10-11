import React, { useEffect, useState } from 'react';
import type { AsrCue } from '@translate/contracts';
import { Subtitles, Eye, EyeOff, Sliders } from 'lucide-react';

export interface BilingualCue extends AsrCue {
  translatedText?: string;
}

interface SubtitleOverlayProps {
  cues: BilingualCue[];
  currentTime: number;
  fontSize?: number; // 基础字号 px
  showOriginal?: boolean;
  showTranslation?: boolean;
  bottomPercent?: number;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  cues,
  currentTime,
  fontSize = 18,
  showOriginal = true,
  showTranslation = true,
  bottomPercent = 10,
}) => {
  // 查找当前时间对应的活跃字幕 Cue
  const activeCue = cues.find(
    (c) => currentTime >= c.startTime && currentTime <= c.endTime
  );

  if (!activeCue) {
    return null;
  }

  return (
    <div
      className="omni-subtitle-container"
      style={{ bottom: `${bottomPercent}%` }}
    >
      {/* 原文轨道 */}
      {showOriginal && activeCue.text && (
        <div
          className="omni-subtitle-text-orig"
          style={{ fontSize: `${fontSize * 0.9}px` }}
        >
          {activeCue.text}
        </div>
      )}

      {/* 译文轨道 */}
      {showTranslation && activeCue.translatedText && (
        <div
          className="omni-subtitle-text-trans"
          style={{ fontSize: `${fontSize}px` }}
        >
          {activeCue.translatedText}
        </div>
      )}
    </div>
  );
};

/**
 * 带有全套控制栏和测试播放器的独立视频字幕容器组件
 */
export const VideoSubtitlePlayer: React.FC<{
  initialCues?: BilingualCue[];
}> = ({ initialCues }) => {
  const [cues, setCues] = useState<BilingualCue[]>(
    initialCues || [
      {
        id: 'cue-1',
        startTime: 0.5,
        endTime: 3.5,
        text: 'Welcome to the bilingual browser translation tutorial.',
        translatedText: '欢迎观看双语浏览器翻译扩展实战教程。',
      },
      {
        id: 'cue-2',
        startTime: 3.8,
        endTime: 7.2,
        text: 'In this session, we demonstrate real-time offline speech recognition.',
        translatedText: '在本次演练中，我们演示基于本地模型的实时离线语音识别。',
      },
      {
        id: 'cue-3',
        startTime: 7.5,
        endTime: 11.8,
        text: 'Timestamps and audio cues remain aligned throughout media playback.',
        translatedText: '在整个媒体播放过程中，时间戳与字幕轨道均保持严格对齐。',
      },
      {
        id: 'cue-4',
        startTime: 12.0,
        endTime: 16.5,
        text: 'Both cloud models and local offline Ollama are fully supported.',
        translatedText: '公网云端大模型与本地离线 Ollama 均获得完整的原生支持。',
      },
    ]
  );

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);
  const [showTrans, setShowTrans] = useState(true);
  const [fontSize, setFontSize] = useState(18);

  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= 17) return 0;
          return +(prev + 0.2).toFixed(1);
        });
      }, 200);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <Subtitles className="h-4 w-4 text-blue-600" />
          <h3 className="text-xs font-semibold text-slate-800">HTML5 视频双语悬浮字幕预览</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${
              showOriginal ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            原文: {showOriginal ? '开' : '关'}
          </button>
          <button
            onClick={() => setShowTrans(!showTrans)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${
              showTrans ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            译文: {showTrans ? '开' : '关'}
          </button>
        </div>
      </div>

      {/* 模拟视频播放视窗 */}
      <div className="relative flex h-52 w-full flex-col items-center justify-center overflow-hidden rounded-lg bg-slate-900 text-white select-none shadow-inner">
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-slate-900/40 to-slate-900/90" />

        <div className="z-10 text-center space-y-1">
          <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] font-mono text-slate-300">
            虚拟视频播放源 (HTML5 Canvas / Video)
          </span>
          <p className="font-mono text-2xl font-bold tracking-wider text-slate-200">
            {Math.floor(currentTime / 60)}:
            {String(Math.floor(currentTime % 60)).padStart(2, '0')}.
            {Math.floor((currentTime % 1) * 10)}
          </p>
        </div>

        {/* 悬浮双语字幕挂载 */}
        <SubtitleOverlay
          cues={cues}
          currentTime={currentTime}
          fontSize={fontSize}
          showOriginal={showOriginal}
          showTranslation={showTrans}
          bottomPercent={12}
        />
      </div>

      {/* 播放控制与滑块 */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            {isPlaying ? '暂停' : '播放字幕轴'}
          </button>
          <button
            onClick={() => setCurrentTime(0)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            重置
          </button>
        </div>

        {/* 进度控制滑块 */}
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <span className="text-[10px] font-mono text-slate-400">0s</span>
          <input
            type="range"
            min="0"
            max="16.5"
            step="0.1"
            value={currentTime}
            onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
          />
          <span className="text-[10px] font-mono text-slate-400">16.5s</span>
        </div>

        {/* 字号微调 */}
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="text-[10px] text-slate-400">字号:</span>
          <button
            onClick={() => setFontSize(Math.max(14, fontSize - 2))}
            className="rounded border border-slate-200 px-1 text-[10px] hover:bg-slate-100"
          >
            -
          </button>
          <span className="font-mono text-[10px]">{fontSize}px</span>
          <button
            onClick={() => setFontSize(Math.min(28, fontSize + 2))}
            className="rounded border border-slate-200 px-1 text-[10px] hover:bg-slate-100"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
};
