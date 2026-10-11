import type { TranslationUnit } from './dom-walker';
import type { TranslationSegmentResult } from '@translate/contracts';
import { fastTextHash } from './hash.ts';

export interface MountedRecord {
  id: string;
  element: HTMLElement;
  wrapper: HTMLElement;
  originalText: string;
  translatedText: string;
  sourceHash: string;
  isReverted: boolean;
}

export class DOMMounter {
  private records = new Map<string, MountedRecord>();
  private isGloballyReverted: boolean = false;

  /**
   * 为翻译单元创建预挂载占位节点（Loading 状态）
   */
  public mountPlaceholder(unit: TranslationUnit): HTMLElement | null {
    if (!unit.element.isConnected) return null;

    // 检查是否已存在
    const existing = this.records.get(unit.id);
    if (existing && existing.wrapper.isConnected) {
      return existing.wrapper;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'translate-bilingual-wrapper translate-loading';
    wrapper.setAttribute('data-trans-id', unit.id);
    wrapper.setAttribute('data-source-hash', unit.sourceHash);
    wrapper.textContent = '翻译中...';

    // 挂载到原元素之后（作为兄弟节点）
    try {
      unit.element.insertAdjacentElement('afterend', wrapper);
    } catch {
      // 若原节点处于特殊容器，尝试追加为其直接子末尾
      unit.element.appendChild(wrapper);
    }

    this.records.set(unit.id, {
      id: unit.id,
      element: unit.element,
      wrapper,
      originalText: unit.text,
      translatedText: '',
      sourceHash: unit.sourceHash,
      isReverted: false,
    });

    return wrapper;
  }

  /**
   * 挂载或更新最终译文
   */
  public mountTranslation(unit: TranslationUnit, result: TranslationSegmentResult): boolean {
    const record = this.records.get(unit.id);
    const wrapper = record?.wrapper || this.mountPlaceholder(unit);
    if (!wrapper || !unit.element.isConnected) return false;

    // 校验原文是否已被篡改
    const currentText = (unit.element.innerText || unit.element.textContent || '').trim();
    const currentHash = fastTextHash(currentText);
    if (currentHash !== unit.sourceHash) {
      console.warn(`[DOMMounter] Text changed for segment ${unit.id}, discarding stale translation`);
      wrapper.remove();
      this.records.delete(unit.id);
      return false;
    }

    if (result.error) {
      wrapper.className = 'translate-bilingual-wrapper translate-error';
      wrapper.textContent = `[翻译错误: ${result.error.code}] ${result.error.message}`;
      return false;
    }

    wrapper.className = 'translate-bilingual-wrapper';
    wrapper.textContent = result.translation;

    if (record) {
      record.translatedText = result.translation;
      record.isReverted = this.isGloballyReverted;
      if (this.isGloballyReverted) {
        wrapper.style.display = 'none';
      }
    }

    return true;
  }

  /**
   * 一键撤销（隐藏所有译文容器，恢复纯净页面）
   */
  public revertAll() {
    this.isGloballyReverted = true;
    for (const record of this.records.values()) {
      if (record.wrapper && record.wrapper.isConnected) {
        record.wrapper.style.display = 'none';
        record.isReverted = true;
      }
    }
  }

  /**
   * 一键恢复（重新显示已缓存的译文容器）
   */
  public restoreAll() {
    this.isGloballyReverted = false;
    for (const record of this.records.values()) {
      if (record.wrapper && record.wrapper.isConnected && record.translatedText) {
        record.wrapper.style.display = 'block';
        record.isReverted = false;
      }
    }
  }

  /**
   * 完全移除所有注入的 DOM 节点并清空状态
   */
  public clearAll() {
    for (const record of this.records.values()) {
      if (record.wrapper && record.wrapper.isConnected) {
        record.wrapper.remove();
      }
    }
    this.records.clear();
    this.isGloballyReverted = false;
  }

  public getStatus() {
    return {
      total: this.records.size,
      isReverted: this.isGloballyReverted,
      completed: Array.from(this.records.values()).filter((r) => Boolean(r.translatedText)).length,
    };
  }
}
