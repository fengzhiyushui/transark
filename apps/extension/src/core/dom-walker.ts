import { fastTextHash, generateSegmentId } from './hash.ts';

export interface TranslationUnit {
  id: string;
  element: HTMLElement;
  text: string;
  sourceHash: string;
}

const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CODE',
  'PRE',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BUTTON',
  'SVG',
  'CANVAS',
  'AUDIO',
  'VIDEO',
  'IFRAME',
  'OBJECT',
  'EMBED',
]);

const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'ARTICLE',
  'SECTION',
  'ASIDE',
  'NAV',
  'HEADER',
  'FOOTER',
  'DT',
  'DD',
  'FIGCAPTION',
  'TD',
  'TH',
]);

/**
 * 校验元素是否属于无需翻译或插件自身注入的元素
 */
export function isElementIgnored(el: Element): boolean {
  if (IGNORED_TAGS.has(el.tagName)) return true;

  // 自身挂载的译文容器与插件 UI 容器跳过
  if (el.classList.contains('translate-bilingual-wrapper')) return true;
  if (el.closest('.translate-bilingual-wrapper')) return true;
  if (
    el.id === 'omni-translate-root' ||
    el.id === 'transark-root' ||
    el.id === 'yizhou-root' ||
    el.closest('#omni-translate-root') ||
    el.closest('#transark-root') ||
    el.closest('#yizhou-root')
  ) return true;
  if (el.classList.contains('notranslate')) return true;
  if (el.getAttribute('translate') === 'no') return true;

  return false;
}

/**
 * 判断元素在页面中当前是否可见。
 *
 * 性能要点：`getComputedStyle` 会强制样式重算（forced reflow），
 * 在长页面上对数百个元素逐个调用可能造成 10–100ms 级主线程阻塞。
 * 因此这里改为：
 *  1. 先用最廉价的 `isConnected` / `offsetWidth|offsetHeight` 判定；
 *  2. 仅当尺寸为 0（可能是隐藏，也可能是仿真环境无渲染管线）时，
 *     才回退到 `getComputedStyle`。
 *
 * 这样在真实浏览器中，绝大多数可见元素都不需要触碰 computedStyle。
 */
export function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;

  // 1. 廉价路径：有布局尺寸即视为可见（读取 offsetWidth 会触发布局，
  //    但比 getComputedStyle 的全量样式解析便宜得多）
  const hasDimensions = el.offsetWidth > 0 || el.offsetHeight > 0;
  if (hasDimensions) {
    return true;
  }

  // 2. 尺寸为 0：可能是真实隐藏，也可能是无渲染管线的仿真环境
  const rect = el.getBoundingClientRect?.();
  if (rect && (rect.width > 0 || rect.height > 0)) {
    return true;
  }

  if (typeof window !== 'undefined' && window.getComputedStyle) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
  }

  // 3. 无尺寸但样式未显式隐藏：在 Happy-DOM / JSDOM 等仿真环境中
  //    所有节点尺寸均为 0，此时以样式为准
  return true;
}

/**
 * 检验文本是否具备翻译价值（排除纯空白、标点符号或单字符）
 */
export function isMeaningfulText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  // 必须包含至少一个字母或汉字
  return /[a-zA-Z\u4e00-\u9fa5\u3040-\u30ff]/.test(trimmed);
}

/**
 * 提取元素的直接纯文本（合并子 inline 节点文本，但遇到内部嵌套独立块级时分步处理）
 */
function extractBlockText(el: HTMLElement): string {
  // 如果子节点中包含其他块级元素，则当前节点不作为单一翻译块，由子节点分别处理
  const hasBlockChildren = Array.from(el.children).some(
    (child) => BLOCK_TAGS.has(child.tagName) || child.tagName === 'DIV'
  );
  if (hasBlockChildren) {
    return '';
  }

  return el.innerText || el.textContent || '';
}

/**
 * 扫描 DOM 树，将页面可见块级元素与连续行内节点切分为翻译单元
 */
export function scanTranslationUnits(root: HTMLElement = document.body): TranslationUnit[] {
  const units: TranslationUnit[] = [];
  const processedElements = new Set<HTMLElement>();
  let segmentIndex = 0;

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as HTMLElement;
        if (isElementIgnored(el)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let currentNode = walker.currentNode as HTMLElement;
  while (currentNode) {
    const el = currentNode;

    // 判断是否为标准块级元素或含有文本的无嵌套 DIV
    const isBlock = BLOCK_TAGS.has(el.tagName);
    const isTextDiv =
      el.tagName === 'DIV' &&
      !Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName) || c.tagName === 'DIV');

    if ((isBlock || isTextDiv) && !processedElements.has(el)) {
      if (isElementVisible(el)) {
        const rawText = extractBlockText(el).trim();
        if (isMeaningfulText(rawText)) {
          const id = generateSegmentId(segmentIndex++, rawText);
          const sourceHash = fastTextHash(rawText);

          units.push({
            id,
            element: el,
            text: rawText,
            sourceHash,
          });

          processedElements.add(el);
        }
      }
    }

    currentNode = walker.nextNode() as HTMLElement;
  }

  return units;
}
