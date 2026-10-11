# @translate/extension - 桌面浏览器智能翻译扩展

桌面端跨平台浏览器翻译插件（Chrome / Edge Manifest V3），基于 **WXT + React + TailwindCSS + TypeScript** 构建，深度对接 `@translate/contracts` 契约体系。

---

## 🌟 核心特性与架构

### 1. 扩展基础架构 (Manifest V3)
- **权限配置**：`activeTab`, `storage`, `scripting`, `offscreen`, `tabCapture` 等权限就绪。
- **Background Service Worker** (`entrypoints/background.ts`)：
  - 管理提供者配置（`TranslationProviderConfig`）与存储状态。
  - 承载跨域 fetch 请求中转（避免普通 Content Script 的 CORS 限制，防止网页脚本窃取凭据）。
  - 支持多适配器工厂调度与测试连通性。
- **Popup 弹窗** (`entrypoints/popup/`)：
  - 网页双语翻译全局/单页开关。
  - 实时翻译进度展示与一键撤销/恢复。
  - 目标语言快速切换与活跃服务 Profile 快速选择。
- **设置中心 Options** (`entrypoints/options/`)：
  - 完整的服务配置管理：输入 BaseUrl、API Key、选择通信协议与数据策略（`device-only`, `allow-lan`, `allow-cloud`）。
  - 连通性测试按钮：直接测试所填地址与模型的往返时延及译文样本。
  - 离线 Mock 模拟延迟滑块配置（0ms ~ 1000ms）。

### 2. 统一适配器驱动层 (Provider Adapter Layer)
位于 `src/adapters/`：
- **`TranslationProvider` 接口驱动**：标准化的 `translate(request, signal)` 与 `testConnection(signal)`。
- **`MockProvider`**：
  - 内置丰富对照词典与离线生成逻辑，在**不启动任何本地 Python 后端**的情况下即可完整体验双语段落翻译与恢复。
  - 支持模拟延迟（0~1000ms），支持严格 ID 对齐校验与断言。
- **`OpenAIChatAdapter`**：
  - 自动拼装 Chat Completions 规范的请求路径与 JSON 结构化 Prompt。
  - 统一清洗 Markdown 代码块与解析返回，利用 `alignTranslationResults` 保障段落严格对齐。
- **`OllamaAdapter`**：
  - 面向本地 Ollama 原生 `/api/chat` 端点，支持 `format: "json"` 严格结构化输出与推理度量解析。

### 3. 网页文本处理核心 (Content Script)
位于 `src/core/`：
- **段落识别算法 (`dom-walker.ts`)**：
  - 语义化识别页面可见块级元素（`P`, `H1-H6`, `LI`, `BLOCKQUOTE`, 文本 `DIV` 等）及连续行内文本单元。
  - 严格过滤 `<script>`, `<style>`, `<code>`, `<pre>`, 输入控件、`translate="no"` 及自身注入容器。
  - 提取稳定 ID 与通过 32 位 FNV-1a 算法计算原文 `sourceHash`。
- **可视区域优先队列 (`priority-queue.ts`)**：
  - 利用 `IntersectionObserver` 动态跟踪视口内段落，屏内段落优先调度（优先级 0），屏外延迟并发批处理。
  - 用户向下滚动页面时，新进入视口的段落自动前置插队。
- **译文双语挂载 (`dom-mounter.ts`)**：
  - 绝不篡改原 DOM 节点与事件监听，将译文以独立的 `.translate-bilingual-wrapper` 节点挂载在其下方。
  - 支持**一键撤销 (隐藏译文，恢复干净页面)**与**一键恢复 (重新显示，无需重新请求)**。
  - 挂载前校验原文 Hash，文本篡改时自动丢弃陈旧结果。
- **动态内容适配 (`mutation-manager.ts`)**：
  - 使用 `MutationObserver` 监听增量 DOM 节点，配置 250ms 防抖。
  - 严格过滤自身插入节点与扩展 UI 根节点，从根源防止反复翻译与死循环。

### 4. UI 工作台与高级组件
- **本地文件对照阅读器 (`entrypoints/reader/`)**：
  - 原生支持加载本地 `.txt`, `.md`, `.docx` 文档（基于现代浏览器 `DecompressionStream` 零外部依赖解压与解析）。
  - 支持「左右分栏」与「上下逐段」对照阅读模式。
  - 支持全篇批量翻译、单段重译、译文快速复制与导出双语文件。
- **HTML5 视频悬浮字幕容器 (`SubtitleOverlay.tsx`)**：
  - 浮动在视频上方的高对比度双语字幕渲染容器（支持背景模糊与高辨识度文字阴影）。
  - 基于精准时间戳（`currentTime >= startTime && currentTime <= endTime`）实时同步双语字幕轨。
  - 支持字号微调与原文/译文独立开关。

---

## 🚀 常用命令

```bash
# 进入扩展目录
cd apps/extension

# 执行类型检查 (零报错)
pnpm run typecheck

# 运行自动化单元测试 (包含适配器、Hash、DOM识别与双语挂载测试)
pnpm run test

# 构建生产扩展包 (输出位于 .output/chrome-mv3)
pnpm run build
```

---

## 🖥️ 在 Chrome / Edge 浏览器中体验

1. 打开浏览器扩展管理页面：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
2. 开启右上角 **「开发者模式 (Developer mode)」**。
3. 点击 **「加载已解压的扩展程序 (Load unpacked)」**。
4. 选择目录：`apps/extension/.output/chrome-mv3`（即项目根目录下生成的编译产物路径）。
5. 体验方式：
   - 打开扩展内的自带测试页：直接在浏览器打开 `chrome-extension://<扩展ID>/demo.html`。
   - 打开本地对照阅读器：点击扩展图标中的「阅读器」或直接打开 `chrome-extension://<扩展ID>/reader.html`。
   - 进入设置中心：点击「设置」或右键图标「选项」。
   - 在任意英文网页上点击扩展 Popup 弹窗的翻译开关，即可以 Mock 模式（或配置的 Ollama / OpenAI）体验丝滑的双语段落阅读与一键撤销/恢复！
