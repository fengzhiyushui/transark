# 译舟 (TransArk) - 完整上手与实战教程

本教程详细指导如何从源码构建、安装配置、日常使用以及将「译舟 (TransArk)」接入不同大模型引擎与本地伴随服务。

---

## 目录
1. [快速安装与构建](#1-快速安装与构建)
2. [浏览器扩展三大界面详解](#2-浏览器扩展三大界面详解)
3. [多模型接入配置实战](#3-多模型接入配置实战)
   - [场景 A：OpenAI 兼容 API 接入（推荐，覆盖面最广）](#场景-aopenai-兼容-api-接入推荐覆盖面最广)
   - [场景 B：Anthropic / Gemini 协议接入](#场景-banthropic--gemini-协议接入)
   - [场景 C：云端大模型 BYOK 接入（OpenAI / DeepSeek 等）](#场景-c云端大模型-byok-接入openai--deepseek-等)
4. [核心功能实战演练](#4-核心功能实战演练)
   - [实战 1：网页双语对照阅读与撤销恢复](#实战-1网页双语对照阅读与撤销恢复)
   - [实战 2：本地文档双语工作台使用](#实战-2本地文档双语工作台使用)
   - [实战 3：视频双语字幕悬浮体验](#实战-3视频双语字幕悬浮体验)
5. [全离线环境验证指南](#5-全离线环境验证指南)
6. [常见问题与排错 (FAQ)](#6-常见问题与排错-faq)

---

## 1. 快速安装与构建

### 1.1 环境检查
请确保本地已安装：
- **Node.js** >= 18.0.0
- **pnpm** >= 9.0.0
- **Chrome** 或 **Edge** 浏览器最新稳定版

### 1.2 源码编译
```bash
# 1. 检出代码并进入根目录
git clone https://github.com/fengzhiyushui/transark.git
cd transark

# 2. 安装 Monorepo 依赖
pnpm install

# 3. 编译共享契约与浏览器扩展
pnpm --filter @translate/contracts build
pnpm --filter @translate/extension build
```
编译完成后，生产环境扩展包位于：`apps/extension/.output/chrome-mv3`。

### 1.3 载入浏览器
1. 打开 Chrome 访问 `chrome://extensions/`（或 Edge 访问 `edge://extensions/`）。
2. 在页面右上角打开 **「开发者模式 (Developer Mode)」** 开关。
3. 点击左上角 **「加载已解压的扩展程序 (Load unpacked)」**。
4. 在弹出的文件选择器中，定位并选中 `apps/extension/.output/chrome-mv3` 文件夹。
5. 浏览器扩展列表将出现 **「译舟 (TransArk) - 智能双语阅读与音视频翻译」**，点击扩展图标固定到工具栏。

---

## 2. 浏览器扩展三大界面详解

### 2.1 Popup 弹窗（日常操作控制台）
点击浏览器工具栏中的「译舟」图标，即可弹出浮窗：
- **翻译总开关**：一键开启或关闭当前标签页的网页翻译。
- **活跃配置切换**：快速在不同 API 接入配置（OpenAI 兼容 / Anthropic / Gemini）间切换。
- **目标语言**：支持切换至中文（简体）、英语、日语、韩语等。
- **实时进度条**：显示当前页面已翻译段落数、待处理段落数与总段落数。
- **一键撤销 / 恢复**：
  - 点击「撤销」：瞬时隐藏所有译文，页面原样还原；
  - 点击「恢复」：直接唤醒已缓存的译文，零等待秒级重现。

### 2.2 Options 设置中心（模型与安全策略配置）
右键扩展图标选择「选项」，或在 Popup 弹窗中点击齿轮图标：
- **添加/编辑 Profile**：
  - `接入方式`：当前版本**仅支持 API 接入**，通过 `protocol` 选择 OpenAI / Anthropic / Gemini 协议。
  - `Profile ID`：唯一标识（如 `api-openai-chat`, `deepseek-chat`）。
  - `API 协议`（选择 API 接入时出现）：
    - `openai-chat`：OpenAI Chat Completions，**事实标准**，兼容 DeepSeek / Kimi / 通义 / 硅基流动 / vLLM / One-API 等绝大多数网关；
    - `openai-responses`：OpenAI Responses API（`/v1/responses`）；
    - `anthropic-messages`：Anthropic Messages API；
    - `gemini-generate`：Google Gemini `generateContent`。
  - `Base URL`：服务根地址（如 `https://api.deepseek.com/v1`）。
  - `API Key`：鉴权令牌（保存在浏览器隔离的本地存储中）。
  - `模型名称`：可点击「获取模型」一键拉取该服务的可用模型列表并下拉选择；拉取失败（如浏览器跨域限制）时可直接手动填写模型 ID。
  - `数据策略 (Data Policy)`：
    - `device-only`：严禁外网，仅允许回环地址；
    - `allow-lan`：允许内网服务器与网关；
    - `allow-cloud`：允许公网云端大模型。
- **连通性测试 (Test Connection)**：填写配置后点击测试按钮，扩展将向目标服务发送一段标准文本，返回往返时延（毫秒）与译文，确保连通无误后方可保存。

### 2.3 Reader 工作台（文档与字幕独立阅读器）
在浏览器中打开 `chrome-extension://<你的扩展ID>/reader.html`（或在 Header 栏点击「文档工作台」图标）：
- 提供沉浸式的无干扰对照阅读环境。
- 支持直接拖拽本地文件解析。
- 支持单段手动重新翻译、段落复制与双语对照导出。

---

## 3. 多模型接入配置实战

### 场景 A：OpenAI 兼容 API 接入（推荐，覆盖面最广）

绝大多数国内外模型服务都提供 OpenAI Chat Completions 兼容端点，因此这是首选协议。

1. **在译舟设置中心中添加 Profile**：
   - 接入方式：`API 接入`
   - API 协议：`openai-chat`
   - Profile 名称：`DeepSeek`
   - Base URL：`https://api.deepseek.com/v1`
   - API Key：填入你在该平台申请的密钥
2. **获取并选择模型**：点击「获取模型」按钮，扩展会请求 `{BaseUrl}/models` 并列出可用模型，从下拉列表中选择即可。若拉取失败，也可直接手动填写模型 ID（如 `deepseek-chat`）。
3. **数据策略**：选择 `allow-cloud`（允许公网云端）。
4. **点击「测试连通性」**：显示连接成功且测得往返时延与译文样本后，点击「保存并设为当前活跃 Profile」。

> **其他常见服务示例**
> | 服务 | Base URL | 模型示例 |
> |---|---|---|
> | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
> | 硅基流动 (SiliconFlow) | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
> | 月之暗面 Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
> | 自建 vLLM / One-API 网关 | `http://127.0.0.1:8000/v1` | 你部署的模型名 |
>
> 自建网关指向回环地址时，可将数据策略设为 `device-only`；指向内网服务器时用 `allow-lan`。

---

### 场景 B：Anthropic / Gemini 协议接入

这两家不遵循 OpenAI 规范，需选择对应协议：

- **Anthropic**：协议选 `anthropic-messages`，Base URL 填 `https://api.anthropic.com/v1`，模型如 `claude-3-5-sonnet-20241022`。扩展会自动携带 `anthropic-version` 版本头与浏览器直连所需的 `anthropic-dangerous-direct-browser-access` 头。
- **Google Gemini**：协议选 `gemini-generate`，Base URL 填 `https://generativelanguage.googleapis.com/v1beta`，模型如 `gemini-2.5-flash`。

> **提示**：Anthropic 与 Gemini 官方未开放浏览器可访问的 `/models` 列举端点，因此「获取模型」会降级为内置候选列表供选择，你也可以直接手动输入模型 ID。

---

### 场景 C：云端大模型 BYOK 接入（OpenAI / DeepSeek 等）
适用于追求高翻译质量、允许文本走云端加密传输的用户：

1. **获取供应商 API 凭据**（例如 DeepSeek 或 OpenAI）。
2. **在译舟设置中心中配置**：
   - Profile 名称：`DeepSeek 翻译`
   - 协议类型：`openai-chat`
   - 服务根地址：`https://api.deepseek.com/v1`
   - API Key：`sk-xxxxxxxxxxxxxxxxxxxxxxxx`
   - 目标模型：`deepseek-chat`
   - 数据策略：`allow-cloud`（明确声明允许云端调用）
3. **连通性测试与保存**：译舟将以标准的 JSON 结构化格式进行分段对齐翻译，保证回填精准。

> **想连接本机模型？** 使用 **API 接入 + `openai-chat` 协议**，Base URL 填 Ollama（`http://127.0.0.1:11434/v1`）、vLLM 或 LM Studio 的兼容地址即可；扩展不再提供独立的「本地接入」模式。

---

## 4. 核心功能实战演练

### 实战 1：网页双语对照阅读与撤销恢复
1. 加载扩展后，在浏览器中打开自带的集成测试演示页：
   `chrome-extension://<扩展ID>/demo.html`
2. 页面包含不同层级的标题、正文段落、引用块与动态容器。
3. 点击测试栏中的 **「模拟触发整页翻译」**：
   - 可以观察到屏幕视口内的段落首先出现双语对照；
   - 译文以独立的容器挂载在原节点下方，字体样式优雅融合；
   - 点击 **「一键撤销」**，所有译文毫秒级隐藏；
   - 点击 **「一键恢复」**，已缓存的译文毫秒级重新显现；
   - 点击 **「插入动态内容」**，测试增量监听是否自动对新插入的节点进行识别与翻译。

### 实战 2：本地文档双语工作台使用
1. 打开 `chrome-extension://<扩展ID>/reader.html`。
2. 切换到「本地文档阅读」选项卡。
3. 将项目自带测试文档 `tests/fixtures/documents/sample.txt` 拖拽到上传区域。
4. 页面将自动完成段落切分并生成左右分栏视图：
   - 左侧为原文字段，右侧为对应译文字段；
   - 支持自由切换「左右分栏模式」或「逐段上下对照模式」；
   - 翻译完成后，点击右上角「导出对照 TXT」即可在本地生成双语文档。

### 实战 3：视频双语字幕体验
1. 在网页中播放任意 HTML5 `<video>`（YouTube 会优先走站点字幕适配器）。
2. 打开扩展 Popup，点击「视频双语字幕」卡片中的 **开启字幕**：
   - 有内嵌字幕轨：直接读取并翻译；
   - YouTube：读取 `captionTracks` 并抓取 timedtext；
   - 都没有：若已在设置中配置云端服务，自动进入实时 ASR；
   - 也可以点击 **导入字幕** 选择本地 `.srt/.vtt`。
3. 原文与译文会在视频上方的悬浮层中双语同步显示，随进度条/倍速自动切换。

---

## 5. 本机模型接入与网络边界

扩展当前**只保留 API 接入**，不再有独立的「本地接入」模式；但这不影响连接本机模型：

1. 用 Ollama（`http://127.0.0.1:11434/v1`）、vLLM 或 LM Studio 启动 OpenAI 兼容服务；
2. 在设置中新建 Profile，协议选 `openai-chat`，Base URL 填上述地址，模型填本机模型名；
3. 保存后即可翻译。请求只发往你填写的地址，不会自动切换到其他供应商。

> **注意**：扩展本身没有 `NetworkGuard`；出口守卫位于独立的本地伴随服务（`services/local`）中，扩展当前不直接调用它。请自行确认 Base URL 指向可信端点。

---

## 6. 常见问题与排错 (FAQ)

### Q1: 扩展加载时提示“清单文件缺失或无法读取”？
**A**: 请确保你加载的是 `apps/extension/.output/chrome-mv3` 文件夹，而不是 `apps/extension` 源码根目录。必须先执行 `pnpm --filter @translate/extension build` 生成编译产物。

### Q2: 翻译后网页部分富文本按钮点击无反应或排版错乱？
**A**: 译舟采用非侵入式架构，译文以兄弟节点追加在原标签之后，不会修改宿主标签的原生 DOM 树与事件绑定。如果目标网站有严格的 CSS 布局导致溢出，可切换为「仅显示原文」或点击一键撤销。

### Q3: 连接本地服务失败，报 `NETWORK_ERROR`？
**A**:
1. 检查本地服务是否已启动（如 `ollama serve`，或你的 vLLM / LM Studio 服务）；
2. 确认地址在浏览器中可访问（Ollama 用 `http://127.0.0.1:11434`，注意 Base URL 需带 `/v1` 后缀）；
3. 如果是在 macOS / Linux 环境中，请确认服务允许被浏览器扩展跨域访问（Ollama 可配置环境变量 `OLLAMA_ORIGINS="chrome-extension://*"`）。

### Q4: 原来的「本地接入」模式去哪了？
**A**: 该模式已移除。现在统一使用 **API 接入**：选择 `openai-chat` 协议，把 Base URL 指向本机兼容服务（如 `http://127.0.0.1:11434/v1`）即可；扩展不会伪装本地推理，也不会自动回退云端。

### Q5: 「获取模型」拉取列表失败怎么办？
**A**: 部分服务未开放浏览器可访问的 `/models` 端点（受 CORS 限制），或需要特定鉴权头。此时可直接**手动输入模型 ID**，不影响正常翻译。

### Q6: 翻译速度慢，如何优化？
**A**: 按影响程度排序：
1. **换用低首字延迟的模型**：翻译任务输入输出都短，**首 token 延迟（TTFT）比吞吐更关键**。优先选 `*-mini` / `*-flash` / `*-turbo` 这类轻量模型；**避免推理模型**（如 o1 / R1 系列），它们会先生成大段思维链，延迟可能是普通模型的数十倍。
2. **提升账号配额**：云端 API 普遍按 RPM + TPM 双限，并发达到配额上限后会触发 `429`。这是云端场景的主要天花板。
3. 译舟已默认启用**流式逐段回填**：每段一到达就立即显示，无需等待整批完成。
