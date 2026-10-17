/**
 * Offscreen Document：标签页音频采集 + 云端流式 ASR。
 *
 * 为什么必须放在 offscreen：
 * - MV3 Service Worker 没有 DOM/AudioContext，无法处理 MediaStream；
 * - `tabCapture.getMediaStreamId` + offscreen `getUserMedia` 是 Chrome 官方
 *   推荐的标签页音频捕获方式。
 *
 * 数据路径：tab audio → AudioContext(16k) → ScriptProcessor → int16 PCM
 *          → WebSocket → 云端 ASR → cue/translation 事件 → Background → Content。
 */

import { openAsrStream, type AsrStreamHandle } from '../../src/cloud/client';
import type { AsrCue } from '@translate/contracts';

interface StartPayload {
  streamId: string;
  endpoint: string;
  apiKey: string;
  targetLanguage: string;
  sourceLanguage?: string;
  sessionId: string;
  tabId: number;
}

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;
let asrStream: AsrStreamHandle | null = null;
let currentTabId: number | null = null;

function emit(event: Record<string, unknown>): void {
  if (currentTabId === null) return;
  try {
    const result = chrome.runtime.sendMessage({
      type: 'ASR_EVENT',
      payload: { tabId: currentTabId, event },
    });
    // MV3 返回 Promise；忽略接收方无响应的错误
    (result as Promise<unknown> | undefined)?.catch?.(() => {});
  } catch {
    // 扩展上下文正在卸载时忽略
  }
}

function stopCapture(): void {
  try {
    asrStream?.stop();
    asrStream?.close();
  } catch {
    // 忽略关闭异常
  }
  asrStream = null;

  if (processor) {
    processor.onaudioprocess = null;
    processor.disconnect();
    processor = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (audioContext) {
    void audioContext.close().catch(() => {});
    audioContext = null;
  }
  currentTabId = null;
}

async function startCapture(payload: StartPayload): Promise<void> {
  stopCapture();
  currentTabId = payload.tabId;

  // 1. 通过 streamId 接管标签页音频（不弹二次授权）
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: payload.streamId,
      },
    } as unknown as MediaTrackConstraints,
    video: false,
  });

  // 2. 云端 WS（Key 只在扩展上下文内传递，不进入网页 DOM）
  let finalized = false;
  const finish = (durationSec: number) => {
    if (finalized) return;
    finalized = true;
    emit({ kind: 'final', durationSec });
  };
  asrStream = openAsrStream(
    {
      endpoint: payload.endpoint,
      apiKey: payload.apiKey,
      enabled: true,
      asrFallback: true,
    },
    {
      sessionId: payload.sessionId,
      sampleRate: 16000,
      sourceLanguage: payload.sourceLanguage,
      targetLanguage: payload.targetLanguage,
    },
    {
      onStarted: (sessionId) => emit({ kind: 'started', sessionId }),
      onCue: (cue: AsrCue) => emit({ kind: 'cue', cue }),
      onTranslation: (cueId, translation) => emit({ kind: 'translation', cueId, translation }),
      onFinal: (durationSec) => finish(durationSec),
      onError: (error) =>
        emit({ kind: 'error', error: { code: error.code, message: error.message } }),
      onClose: () => finish(0),
    }
  );

  // 3. 16kHz 单声道 PCM；ScriptProcessor 兼容性最好，后续可平滑替换为 AudioWorklet
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    if (!asrStream) return;
    const input = event.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    asrStream.sendPcm(pcm.buffer);
  };
  source.connect(processor);
  // 旁路到扬声器，避免 tabCapture 接管后用户听不到原视频声音
  source.connect(audioContext.destination);
  processor.connect(audioContext.destination);
  await audioContext.resume();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OFFSCREEN_ASR_START') {
    startCapture(message.payload as StartPayload)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        stopCapture();
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }
  if (message?.type === 'OFFSCREEN_ASR_STOP') {
    stopCapture();
    sendResponse({ success: true });
    return false;
  }
  if (message?.type === 'PING_OFFSCREEN') {
    sendResponse({ success: true, data: 'OFFSCREEN_PONG' });
    return true;
  }
  return false;
});

console.log('[Offscreen] TransArk subtitle audio processor ready');
