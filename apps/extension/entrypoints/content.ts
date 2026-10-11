import { defineContentScript } from 'wxt/utils/define-content-script';
import { scanTranslationUnits, type TranslationUnit } from '../src/core/dom-walker';
import { ViewportPriorityQueue } from '../src/core/priority-queue';
import { DOMMounter } from '../src/core/dom-mounter';
import { DynamicMutationManager } from '../src/core/mutation-manager';
import { requestTranslation, fetchSettings } from '../src/messaging/client';
import type {
  ExtensionMessage,
  MessageResponse,
  PageTranslationStatus,
} from '../src/messaging/protocol';
import '../src/styles/globals.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'manifest',
  main() {
    console.log('[ContentScript] TransArk (译舟) Content Script injected');

    let isTranslating = false;
    let targetLang = 'zh-CN';
    const mounter = new DOMMounter();
    let queue: ViewportPriorityQueue | null = null;
    let mutationManager: DynamicMutationManager | null = null;

    function initQueue() {
      if (queue) {
        queue.destroy();
      }

      queue = new ViewportPriorityQueue({
        batchSize: 8,
        concurrency: 2,
        translateFn: (req, signal) => requestTranslation(req),
        onBatchTranslated: (response, units) => {
          const respMap = new Map(response.segments.map((s) => [s.id, s]));
          for (const unit of units) {
            const res = respMap.get(unit.id);
            if (res) {
              mounter.mountTranslation(unit, res);
            }
          }
        },
        onError: (err, units) => {
          console.error('[ContentScript] Batch translation error:', err);
          for (const unit of units) {
            mounter.mountTranslation(unit, {
              id: unit.id,
              translation: '',
              error: {
                code: 'INTERNAL_ERROR' as any,
                message: err.message || '翻译失败',
              },
            });
          }
        },
        onProgress: (completed, total) => {
          // 可选页面微型进度更新
        },
      });
    }

    async function startTranslation(lang?: string) {
      if (lang) targetLang = lang;
      isTranslating = true;

      // 若之前处于撤销状态，先恢复已有译文
      mounter.restoreAll();

      if (!queue) {
        initQueue();
      }

      // 1. 扫描页面初始段落
      const initialUnits = scanTranslationUnits(document.body);
      for (const unit of initialUnits) {
        mounter.mountPlaceholder(unit);
      }
      queue!.enqueue(initialUnits);
      queue!.start(targetLang);

      // 2. 启动增量变动监听
      if (!mutationManager) {
        mutationManager = new DynamicMutationManager((newUnits) => {
          if (!isTranslating) return;
          for (const unit of newUnits) {
            mounter.mountPlaceholder(unit);
          }
          queue?.enqueue(newUnits);
        });
        mutationManager.start(document.body);
      }
    }

    function stopTranslation() {
      isTranslating = false;
      queue?.stop();
      mutationManager?.stop();
    }

    function revertToOriginal() {
      mounter.revertAll();
    }

    function restoreTranslations() {
      mounter.restoreAll();
    }

    // 监听来自扩展 Popup / Background 的指令
    chrome.runtime.onMessage.addListener(
      (message: ExtensionMessage, _sender, sendResponse: (res: MessageResponse<any>) => void) => {
        switch (message.type) {
          case 'GET_PAGE_STATUS': {
            const stats = queue?.getStats() || { total: 0, completed: 0, pending: 0 };
            const mounterStatus = mounter.getStatus();
            const status: PageTranslationStatus = {
              isTranslating,
              isReverted: mounterStatus.isReverted,
              totalSegments: stats.total || mounterStatus.total,
              translatedSegments: mounterStatus.completed,
              pendingSegments: stats.pending,
              targetLanguage: targetLang,
              displayMode: mounterStatus.displayMode,
            };
            sendResponse({ success: true, data: status });
            break;
          }

          case 'SET_DISPLAY_MODE': {
            const { mode } = message.payload || { mode: 'bilingual' };
            mounter.setDisplayMode(mode);
            sendResponse({ success: true, data: mode });
            break;
          }

          case 'TOGGLE_PAGE_TRANSLATION': {
            const { enabled, targetLanguage } = message.payload || {};
            if (enabled) {
              startTranslation(targetLanguage);
            } else {
              stopTranslation();
              revertToOriginal();
            }
            sendResponse({ success: true, data: isTranslating });
            break;
          }

          case 'RESTORE_PAGE_ORIGINAL': {
            mounter.setDisplayMode('original-only');
            sendResponse({ success: true });
            break;
          }

          default:
            sendResponse({ success: false, error: 'Unhandled content script message' });
        }
        return true;
      }
    );

    // 检查设置并自动启动（若启用了 autoTranslate）
    fetchSettings()
      .then((settings) => {
        targetLang = settings.targetLanguage || 'zh-CN';
        if (settings.autoTranslate) {
          startTranslation(targetLang);
        }
      })
      .catch(() => {});
  },
});
