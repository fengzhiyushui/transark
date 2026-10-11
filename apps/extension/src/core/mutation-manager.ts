import { isElementIgnored, scanTranslationUnits, type TranslationUnit } from './dom-walker';

export class DynamicMutationManager {
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private pendingNodes = new Set<Node>();
  private readonly onNewUnits: (units: TranslationUnit[]) => void;
  private readonly debounceMs: number;

  constructor(onNewUnits: (units: TranslationUnit[]) => void, debounceMs: number = 250) {
    this.onNewUnits = onNewUnits;
    this.debounceMs = debounceMs;
  }

  public start(target: Node = document.body) {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      let hasValidMutations = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (let i = 0; i < mutation.addedNodes.length; i++) {
            const node = mutation.addedNodes[i];
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as HTMLElement;
              // 严格过滤插件自身注入的译文容器和 UI 根节点，杜绝死循环
              if (isElementIgnored(el)) {
                continue;
              }
              this.pendingNodes.add(node);
              hasValidMutations = true;
            }
          }
        }
      }

      if (hasValidMutations) {
        this.triggerDebouncedScan();
      }
    });

    this.observer.observe(target, {
      childList: true,
      subtree: true,
    });
  }

  private triggerDebouncedScan() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.processPendingNodes();
    }, this.debounceMs);
  }

  private processPendingNodes() {
    const nodes = Array.from(this.pendingNodes);
    this.pendingNodes.clear();

    const discoveredUnits: TranslationUnit[] = [];
    const seenIds = new Set<string>();

    for (const node of nodes) {
      if (!node.isConnected || node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      if (isElementIgnored(el)) continue;

      const units = scanTranslationUnits(el);
      for (const u of units) {
        if (!seenIds.has(u.id)) {
          seenIds.add(u.id);
          discoveredUnits.push(u);
        }
      }
    }

    if (discoveredUnits.length > 0) {
      this.onNewUnits(discoveredUnits);
    }
  }

  public stop() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.observer?.disconnect();
    this.observer = null;
    this.pendingNodes.clear();
  }
}
