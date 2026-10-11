/**
 * Offscreen Document 执行环境
 * 专用于处理 tabCapture 音频流、离线音频重采样与传递给本地 ASR
 */

console.log('[Offscreen] TransArk (译舟) offscreen audio processor active');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING_OFFSCREEN') {
    sendResponse({ success: true, data: 'OFFSCREEN_PONG' });
    return true;
  }
  return false;
});
