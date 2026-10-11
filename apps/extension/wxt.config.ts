import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '译舟 (TransArk) - 智能双语阅读与音视频翻译',
    description: 'Chrome / Edge 隐私优先智能翻译扩展：网页双语对照、本地文档阅读、视频悬浮字幕与多协议模型适配',
    version: '0.1.0',
    permissions: [
      'activeTab',
      'storage',
      'scripting',
      'offscreen',
      'tabCapture',
    ],
    host_permissions: [
      'http://localhost/*',
      'http://127.0.0.1/*',
      'https://*/*',
      'http://*/*',
    ],
    action: {
      default_title: '译舟翻译',
    },
  },
});
