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
  - 完整的接入配置管理：API 协议、BaseUrl、API Key 与数据策略（`device-only`, `allow-lan`, `allow-cloud`）。
  - 一键获取可用模型列表并下拉选择，拉取失败时可手动输入模型名。
  - 连通性测试按钮：直接测试所填地址与模型的往返时延及译文样本。

### 2. 统一适配器驱动层 (Provider Adapter Layer)
位于 `src/adapters/`，**仅保留 API 接入**：通过 `protocol` 选择具体厂商协议；连接本机 Ollama / vLLM 时同样走 API 接入，将 BaseUrl 指向回环地址。

- **`TranslationProvider` 接口驱动**：标准化的 `translate(request, signal)` 与 `testConnection(signal)`。
- **`ApiAdapterBase`**：四个 API 协议适配器的公共基类，统一承载网络错误归一化、HTTP 状态码 → 统一错误码映射、模型输出 JSON 提取与清洗、段落严格对齐（`alignTranslationResults`）与 metrics 组装。
- **`OpenAIChatAdapter`**：覆盖两种 OpenAI 官方形态——
  - `openai-chat`：`/v1/chat/completions`，事实标准，兼容 DeepSeek / Kimi / 通义 / 硅基流动 / vLLM / One-API 等绝大多数网关；
  - `openai-responses`：`/v1/responses`，使用 `instructions` + `input`，输出解析 `output_text` 与 `output[].content[]`。
- **`AnthropicAdapter`**：`/v1/messages`，`x-api-key` 鉴权与 `anthropic-version` 版本头，系统提示词位于顶层 `system` 字段。
- **`GeminiAdapter`**：`/v1beta/models/{model}:generateContent`，`x-goog-api-key` 鉴权，`systemInstruction` + `generationConfig.responseMimeType` 结构化输出。
- **模型获取 (`model-fetcher.ts`)**：按协议访问各厂商真实 `/models` 端点并归一化模型 ID；Anthropic / Gemini 在浏览器无法列举时降级到内置候选列表。

#### 2.1 流式翻译与逐段回填（性能核心）

`ApiAdapterBase.translate(request, signal, onSegment)` 的第三个参数是**逐段增量回调**。传入时若协议声明 `capabilities.streaming`，则走流式路径：模型返回的 SSE 流边收边解析，**每解析出一个完整段落立即回填**，无需等待整批完成。

这解决了此前的关键体验问题——原先必须等整批所有段落返回才渲染，首屏等待等于「批量总耗时」。

各协议的流式事件结构差异由子类的 `extractStreamDelta()` 抹平：

| 协议 | 流式端点 | 增量字段 |
|---|---|---|
| `openai-chat` | `/v1/chat/completions` | `choices[0].delta.content` |
| `openai-responses` | `/v1/responses` | `type === 'response.output_text.delta'` 的 `delta` |
| `anthropic-messages` | `/v1/messages` | `content_block_delta` 的 `delta.text` |
| `gemini-generate` | `:streamGenerateContent?alt=sse` | `candidates[0].content.parts[].text` |

实现要点：

- **`stream-parser.ts`**：字符级增量 JSON 状态机（`IncrementalSegmentParser`）。维护字符串/转义状态，检测 `"segments"` 后的 `[` 作为数组起点；此后每遇到一个顶层 `{...}` 闭合就局部 `JSON.parse` 交付。即便网络分包把 JSON 从中间截断，已完成的对象仍能立即落地。
- **消息通道**：Chrome 消息无法承载回调，故背景页每解析出一段就向发起标签页推送 `TRANSLATE_SEGMENT_STREAM`；`TRANSLATE_SEGMENTS` 的 Promise 在全部完成后才 resolve 为权威结果。
- **回退策略**：仅当错误属于「流式能力不可用」类（`INTERNAL_ERROR` / `NETWORK_ERROR`）时才回退为非流式重试。**鉴权失败与限流（429）原样抛出**——重试只会重复计费并掩盖真实原因。已流式回填的段落不会在回退路径中二次挂载。

### 3. 网页文本处理核心 (Content Script)
位于 `src/core/`：
- **段落识别算法 (`dom-walker.ts`)**：
  - 语义化识别页面可见块级元素（`P`, `H1-H6`, `LI`, `BLOCKQUOTE`, 文本 `DIV` 等）及连续行内文本单元。
  - 严格过滤 `<script>`, `<style>`, `<code>`, `<pre>`, 输入控件、`translate="no"` 及自身注入容器。
  - 提取稳定 ID 与通过 32 位 FNV-1a 算法计算原文 `sourceHash`。
  - `isElementVisible` 先用廉价的 `offsetWidth/offsetHeight` 判定，仅在尺寸为 0 时才回退到 `getComputedStyle`——避免逐元素强制样式重算（forced reflow）造成的主线程阻塞。
- **可视区域优先队列 (`priority-queue.ts`)**：
  - 利用 `IntersectionObserver` 动态跟踪视口内段落，屏内段落优先调度（优先级 0），屏外延迟并发批处理。
  - 用户向下滚动页面时，新进入视口的段落自动前置插队。
  - 队列索引使用 `Map` 而非线性 `find`，避免 observer 回调在长页面上退化为 O(n²)。
  - **批大小 12 / 并发 2**：增大批大小可在不提高请求频率的前提下减少总请求数，是比提高并发更安全的提速手段（并发受上游 RPM 约束，盲目提高会触发 429）。
  - **超长段落单独成批**：避免单个长段落拖慢同批其他短段落的返回。
  - **失败指数退避重试**：默认重试 2 次（400ms 起），与取消信号协作可被中止。
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

### 5. 视频双语字幕（云端服务，方案 A）

- **字幕来源四级回退**：`<video>.textTracks` 内嵌轨道 → 站点适配器（内置 YouTube `captionTracks` + timedtext 解析）→ 用户上传 SRT/VTT（Popup「导入字幕」）→ 云端流式 ASR。
- **有字幕**：`src/subtitles/cues.ts` 解析并建立时间索引，`overlay.ts` 用 Shadow DOM 在视频上方渲染原文/译文双轨；译文经 Background 调云端 `/v1/subtitles/translate?stream=true`，SSE 每 cue 到达即回填。
- **无字幕**：Popup 开关触发 `ASR_START`，Background 通过 `tabCapture.getMediaStreamId` 取流，Offscreen Document 用 `AudioContext(16k)` + ScriptProcessor 转 int16 PCM，经 WebSocket 送入云端 ASR；识别出的 cue 立即上屏并接续翻译。
- **安全边界**：API Key 只存在于 `chrome.storage.local` 与扩展上下文，绝不注入网页 DOM；字幕节点只用 `textContent` 写入。
- **支持范围**：内置站点适配器目前仅 YouTube；其他网站走通用 `textTracks` → 上传 → ASR 回退，DRM 与跨域 iframe 不支持。完整矩阵见 [`docs/VIDEO_SUBTITLE_SUPPORT.md`](../../docs/VIDEO_SUBTITLE_SUPPORT.md)。
- 云端服务：[`services/cloud/README.md`](../../services/cloud/README.md)；方案 B（浏览器端 WASM ASR）：[`docs/PLAN_B_BROWSER_WASM_ASR.md`](../../docs/PLAN_B_BROWSER_WASM_ASR.md)。

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
   - 在任意英文网页上点击扩展 Popup 弹窗的翻译开关，即可以已配置的 **API 接入**（OpenAI 兼容 / Responses / Anthropic / Gemini）体验丝滑的双语段落阅读与一键撤销/恢复！
