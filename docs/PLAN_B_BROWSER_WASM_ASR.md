# 方案 B：浏览器端 WASM ASR 落地计划

> **实施状态：计划中（尚未实施）**。方案 A（云端翻译 + 云端 ASR）已完成并通过 17 项 pytest、真实 HTTP/WS 冒烟与扩展 93 项单测；本文档描述可选的隐私档位，需要额外引入 WASM 运行时与 40–80MB 模型资源，建议作为独立迭代实施。
>
> 适用前提：已完成 **方案 A**。本文档说明如何把「无字幕视频的语音识别」从云端下沉到浏览器端，作为隐私优先的可选档位。
>
> 相关实现：`apps/extension/src/subtitles/`、`apps/extension/entrypoints/offscreen/`、`services/cloud/`。

## 1. 适用场景

| 场景 | 是否适合方案 B | 说明 |
| --- | --- | --- |
| 企业内部培训、会议录像 | 适合 | 音频不出本机，仅字幕文本走云端翻译 |
| 医疗、法务、财务等敏感内容 | 适合 | 可进一步关闭云端翻译，仅保留原文转写 |
| 普通消费级视频观看 | 一般 | 首次需下载 40–80MB 模型，低端设备实时率不足 |
| DRM 保护视频（Netflix 等） | 不适合 | 浏览器不提供可捕获的音频流，A/B 均受限 |
| 移动端 / 低内存设备 | 不适合 | WASM 推理内存占用高，容易触发标签页 OOM |

结论：B 不是 A 的替代，而是 **A 的隐私档位**。默认走 A，用户在设置中显式开启「本机识别」后走 B。

## 2. 目标架构

```text
<video> ── tabCapture ──▶ Offscreen Document
                              │  AudioContext 16kHz / PCM int16
                              ▼
                     Web Worker + WASM Whisper
                              │  cue:{id,startTime,endTime,text}
                              ▼
                     Content Script 字幕管道
                              │  仅文本（不含音频）
                              ▼
                Background ── HTTPS ──▶ 云端翻译服务（复用方案 A）
                              ▼
                     Shadow DOM 双语字幕
```

与方案 A 的唯一区别：**ASR 从云端 WS 换成浏览器内 Web Worker + WASM**；字幕管道、翻译接口、渲染层、消息协议全部复用。

## 3. 技术选型

| 选项 | 体积 | 性能 | 说明 |
| --- | --- | --- | --- |
| `whisper.cpp` WASM（ggml-tiny/base） | wasm ~1–2MB + 模型 40–80MB | 中端笔记本 tiny 可近实时，base 约 0.5–1× 实时 | 推荐；C++ 推理成熟，支持 int8 |
| `@huggingface/transformers`（ONNX Runtime Web） | ORT wasm ~10MB + 模型 40–150MB | WebGPU 可用时较好，CPU 较慢 | 生态好，但包体更大 |
| Web Speech API | 0 | 依赖浏览器/系统，无法保证时间戳与语言 | 不满足双语字幕时间轴要求，不推荐 |

推荐 **whisper.cpp WASM + tiny/base 模型**，按设备能力在设置中提供「速度优先 / 精度优先」两档。

### 合规约束（Chrome Web Store）

- WASM 运行时代码必须**随扩展打包**，不得从远程加载（No Remote Hosted Code）。
- 模型权重属于数据而非代码，可从自有服务器按需下载；必须做完整性校验（SHA-256）并缓存到 IndexedDB / OPFS。
- 首次下载需用户明确确认，展示体积与用途。

## 4. 实施步骤

### 步骤 1：引入 WASM 运行时与模型管理

新增：

```text
apps/extension/public/wasm/whisper/          # whisper.cpp wasm 运行时（随包发布）
apps/extension/src/asr/wasm/
├── model-manager.ts      # 模型下载、SHA-256 校验、IndexedDB 缓存、进度事件
├── whisper-worker.ts     # Web Worker：加载 wasm、接收 PCM、返回 cue
└── wasm-asr.ts           # 主线程封装：Worker 生命周期、消息协议、错误映射
```

`model-manager.ts` 关键点：

- `ensureModel(kind: 'tiny' | 'base')`：命中缓存直接返回；否则 `fetch` + 流式进度 + 校验；
- 存储使用 IndexedDB（大文件）而非 `chrome.storage.local`（配额小）；
- 失败返回契约错误码 `MODEL_UNAVAILABLE` / `OFFLINE_REQUIRED`，不静默降级到云端。

### 步骤 2：Offscreen 采集层复用

`entrypoints/offscreen/main.ts` 已经把「tabCapture → AudioContext → PCM」抽成独立函数。方案 B 只需把下游从 `openAsrStream()`（WebSocket）替换为 `wasmAsr.push(pcm)`：

```ts
// 伪代码：与现有 startCapture 同构
const asr = await createWasmAsr({ model: 'tiny', language: 'auto' });
processor.onaudioprocess = (event) => {
  asr.push(floatToInt16(event.inputBuffer.getChannelData(0)));
};
asr.onCue((cue) => emit({ kind: 'cue', cue }));
```

WASM 推理放在 Worker 中，避免阻塞 offscreen 的音频线程。

### 步骤 3：Worker 内分块推理

- 维护环形缓冲区，按 5–8 秒窗口 + 0.5 秒重叠切片；
- 每次把 int16 PCM 交给 whisper.cpp wasm，得到带相对时间戳的片段；
- 按会话偏移量换算绝对时间，去重后 `postMessage({ type: 'cue', cue })`；
- 窗口大小与线程数按 `navigator.hardwareConcurrency` 自适应，低端设备自动降为 8 秒窗口。

### 步骤 4：设置与开关

`ExtensionSettings` 增加：

```ts
asrBackend: 'cloud' | 'wasm';   // 默认 'cloud'
wasmModel: 'tiny' | 'base';     // 默认 'tiny'
```

Options 的「云端字幕与 ASR」区域增加单选：

- 云端识别（推荐）：音频上传云端，延迟低；
- 本机识别（隐私）：音频不出设备，首次需下载模型。

Content Script 根据 `asrBackend` 选择 `ASR_START`（云端）或直接创建 WASM 管道；两条路径共用 `SubtitleManager.handleAsrCue`。

### 步骤 5：翻译仍走云端

WASM 只负责「音频 → 原文 cue」。译文继续通过 `CLOUD_TRANSLATE_CUES` / `/v1/subtitles/translate` 获取，复用现有流式翻译与缓存。若用户选择「完全离线」，则只显示原文，不调用翻译接口。

## 5. 所需改动清单（相对方案 A）

| 文件 | 改动 |
| --- | --- |
| `apps/extension/public/wasm/whisper/*` | 新增 WASM 运行时资源 |
| `apps/extension/src/asr/wasm/model-manager.ts` | 新增模型下载/校验/缓存 |
| `apps/extension/src/asr/wasm/whisper-worker.ts` | 新增 Worker 推理 |
| `apps/extension/src/asr/wasm/wasm-asr.ts` | 新增主线程封装 |
| `apps/extension/entrypoints/offscreen/main.ts` | 增加 WASM 分支（保留云端 WS 分支） |
| `apps/extension/src/subtitles/manager.ts` | ASR 后端选择；错误处理 |
| `apps/extension/src/storage/extension-storage.ts` | 新增 `asrBackend` / `wasmModel` |
| `apps/extension/entrypoints/options/App.tsx` | 新增识别后端单选与模型下载 UI |
| `apps/extension/wxt.config.ts` | 确认 `web_accessible_resources` 暴露 wasm/模型 |
| `docs/PLAN_B_BROWSER_WASM_ASR.md` | 本文档 |
| 云端服务 | **无需改动**（仍保留 ASR 端点作为默认档） |

## 6. 与方案 A 的差异对比

| 维度 | 方案 A（云端 ASR） | 方案 B（浏览器 WASM ASR） |
| --- | --- | --- |
| 音频去向 | 上传云端 | 不出设备 |
| 首次使用成本 | 0 | 下载 40–80MB 模型 |
| 扩展包体积 | 约 0.4MB | 增加 wasm 运行时约 1–2MB（模型可后下载） |
| 延迟 | 受网络影响，通常 1–3s/窗口 | 受设备算力影响，tiny 约 0.5–1× 实时 |
| 服务端资源 | ASR worker（CPU/GPU） | 0 |
| 离线可用性 | 否（需云端） | 识别可离线，翻译仍需云端 |
| 准确率 | base/small 可选，较高 | tiny 较低，base 接近云端 base |
| 实现复杂度 | 中（WS + 队列 + 扩容） | 高（WASM 构建、Worker、模型缓存、兼容性） |
| DRM 视频 | 受限 | 受限（同样无法捕获音频） |

## 7. 测试与验收

- **单元**：模型管理器缓存命中/校验失败；Worker 消息协议；PCM 切片与时间轴去重。
- **集成**：用 30 秒英文样本音频，断言 cue 数量、时间轴单调递增、译文与 cue id 对齐。
- **性能**：在 4 核 / 8GB 设备上测 tiny 档实时率（目标 ≥ 0.8× 实时）；记录内存峰值（目标 < 500MB）。
- **兼容性**：Chrome 116+（offscreen）、Edge 同版本；低端设备自动降窗。
- **回归**：确保 `asrBackend=cloud` 时方案 A 行为不变。

## 8. 风险与应对

| 风险 | 应对 |
| --- | --- |
| 模型下载失败/被墙 | 提供自有 CDN + 断点续传 + 明确错误提示 |
| 低端设备卡顿 | 自动降为 tiny + 8 秒窗口；UI 提示切换云端 |
| 扩展体积超商店限制 | 模型后下载，wasm 运行时压缩；必要时拆分独立扩展 |
| WASM 内存增长 | Worker 内定期重建推理上下文；限制单会话时长 |
| 时间轴漂移 | 每窗口按绝对偏移校准，重叠区去重（与方案 A 相同的策略） |
