import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GlobalWindow } from 'happy-dom';
import { DOMMounter } from '../src/core/dom-mounter.ts';
import { scanTranslationUnits, isElementIgnored } from '../src/core/dom-walker.ts';
import { fastTextHash } from '../src/core/hash.ts';

let window;
let document;

beforeEach(() => {
  window = new GlobalWindow();
  document = window.document;
  globalThis.window = window;
  globalThis.document = document;
  globalThis.Node = window.Node;
  globalThis.NodeFilter = window.NodeFilter;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
});

describe('DOM Walker and Paragraph Recognition', () => {
  test('correctly identifies valid paragraphs and filters scripts/code/hidden elements', () => {
    document.body.innerHTML = `
      <div id="content">
        <h1>Welcome to TransArk</h1>
        <p>This is the first paragraph with <strong>bold text</strong> and <a href="#">link</a>.</p>
        <code>console.log("ignored code");</code>
        <pre>Preformatted code block</pre>
        <script>const x = 1;</script>
        <div class="translate-bilingual-wrapper">Previously mounted translation</div>
        <p translate="no">Ignored attribute</p>
        <p class="notranslate">Ignored class</p>
        <li>List item to be translated</li>
      </div>
    `;

    // 检查过滤规则
    const scriptEl = document.querySelector('script');
    const codeEl = document.querySelector('code');
    const wrapperEl = document.querySelector('.translate-bilingual-wrapper');
    const notranslateEl = document.querySelector('.notranslate');

    assert.ok(isElementIgnored(scriptEl));
    assert.ok(isElementIgnored(codeEl));
    assert.ok(isElementIgnored(wrapperEl));
    assert.ok(isElementIgnored(notranslateEl));

    // 扫描翻译单元
    const units = scanTranslationUnits(document.getElementById('content'));
    assert.ok(units.length >= 3, `Expected at least 3 units, got ${units.length}`);

    const texts = units.map((u) => u.text);
    assert.ok(texts.some((t) => t.includes('Welcome to TransArk')));
    assert.ok(texts.some((t) => t.includes('This is the first paragraph')));
    assert.ok(texts.some((t) => t.includes('List item to be translated')));
    assert.ok(!texts.some((t) => t.includes('console.log')));
  });
});

describe('DOM Mounter - Bilingual Mounting, Revert and Restore', () => {
  test('mounts translation cleanly after original element preserving events and content', () => {
    document.body.innerHTML = `
      <div id="article">
        <p id="p1">Hello, world!</p>
      </div>
    `;

    const p1 = document.getElementById('p1');
    const mounter = new DOMMounter();
    const unit = {
      id: 'seg-1',
      element: p1,
      text: 'Hello, world!',
      sourceHash: fastTextHash('Hello, world!'),
    };

    // 1. 占位状态
    const placeholder = mounter.mountPlaceholder(unit);
    assert.ok(placeholder);
    assert.ok(placeholder.classList.contains('translate-loading'));
    assert.equal(placeholder.nextElementSibling, null);
    assert.equal(p1.nextElementSibling, placeholder);

    // 2. 挂载完成状态
    const success = mounter.mountTranslation(unit, {
      id: 'seg-1',
      translation: '你好，世界！',
    });
    assert.ok(success);
    assert.ok(!placeholder.classList.contains('translate-loading'));
    assert.equal(placeholder.textContent, '你好，世界！');
    // 原段落必须毫发无损
    assert.equal(p1.textContent, 'Hello, world!');

    // 3. 一键撤销 (隐藏译文)
    mounter.revertAll();
    assert.equal(placeholder.style.display, 'none');
    assert.equal(mounter.getStatus().isReverted, true);

    // 4. 一键恢复 (重新显示译文)
    mounter.restoreAll();
    assert.equal(placeholder.style.display, 'block');
    assert.equal(mounter.getStatus().isReverted, false);

    // 5. 完全清空
    mounter.clearAll();
    assert.equal(p1.nextElementSibling, null);
    assert.equal(mounter.getStatus().total, 0);
  });

  test('drops translation if source paragraph text was modified during request', () => {
    document.body.innerHTML = `
      <p id="p2">Original sentence before edit</p>
    `;
    const p2 = document.getElementById('p2');
    const mounter = new DOMMounter();
    const unit = {
      id: 'seg-2',
      element: p2,
      text: 'Original sentence before edit',
      sourceHash: fastTextHash('Original sentence before edit'),
    };

    mounter.mountPlaceholder(unit);

    // 用户在请求中途修改了段落文字
    p2.textContent = 'Completely modified text by user interaction';

    const mounted = mounter.mountTranslation(unit, {
      id: 'seg-2',
      translation: '原句已被篡改',
    });

    assert.equal(mounted, false, 'Should reject mounting on mutated DOM text');
  });
});
