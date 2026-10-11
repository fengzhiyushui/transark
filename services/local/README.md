# @translate/local-service

本地伴随服务（Local Companion Service）——浏览器翻译产品的本机处理服务。

- 语言/框架：**Python 3.11+（FastAPI + Uvicorn）**
- 监听地址：**仅回环 `127.0.0.1:8765`**（默认拒绝非回环绑定）
- 契约对齐：所有入参/响应字段使用 Pydantic 模型严格校验，与
  [`packages/contracts`](../../packages/contracts/src) 的 TypeScript 接口逐字段对齐
  （camelCase 序列化、`extra='forbid'`、相同错误码与状态枚举）

参考文档：

- [通用接入方案](../../docs/browser-translation-api-integration-2026-10-10.md)
- [实施路线图](../../docs/browser-translation-roadmap-2026-10-10.md)

## 快速开始

```bash
cd services/local

# 安装依赖（Python 3.11+）
pip install -e .            # 运行时依赖
pip install -e ".[dev]"     # 含 pytest

# 启动服务（仅监听 127.0.0.1:8765）
python -m local_service

# 运行测试
python -m pytest            # 或 pnpm --filter @translate/local-service test
```

启动后服务会生成 8 位配对码并写入
`{数据目录}/pairing.json`（数据目录默认
`%LOCALAPPDATA%\translate-local-service`，可用
`LOCAL_SERVICE_DATA_DIR` 覆盖；也可用 `LOCAL_SERVICE_PAIRING_CODE`
直接指定固定配对码，便于自动化）。

交互式文档：<http://127.0.0.1:8765/docs>。

## 端点总览

| 端点 | 鉴权 | 说明 |
| --- | --- | --- |
| `GET /health` | 否 | 健康检查（回环绑定、运行时长、活跃任务数） |
| `POST /v1/pair` | 配对码 | 配对握手，换取 Bearer 令牌 |
| `GET /v1/capabilities` | 否 | 服务能力声明（协议、任务类型、文档/导出格式） |
| `POST /v1/translate` | Bearer | 统一翻译接口（契约 `TranslationRequest/Response`） |
| `POST /v1/documents/parse` | Bearer | TXT/Markdown/DOCX/PDF(坐标)/SRT/VTT → 结构化单元 |
| `POST /v1/documents/export` | Bearer | 双语结果 → Markdown / DOCX |
| `POST /v1/jobs` | Bearer | 创建长任务（`document-ocr`/`video-asr`/`file-translation`/`batch-translation`） |
| `GET /v1/jobs` | Bearer | 任务列表（按 `status`/`type` 过滤） |
| `GET /v1/jobs/{id}` | Bearer | 任务状态轮询（契约 `JobDescriptor`） |
| `POST /v1/jobs/{id}/cancel` | Bearer | 取消任务（协作式，幂等） |
| `GET /v1/jobs/{id}/events` | Bearer | 进度事件 SSE 流（终态自动结束） |
| `GET /v1/offline/status` | Bearer | 离线自检：本地引擎可用性与出口流量报告 |
| `POST /v1/offline/verify` | Bearer | 离线资格验证（回环/出口守卫/device-only/本地冒烟） |
| `GET/PUT/DELETE /v1/providers[/{id}]` | Bearer | 服务配置 Profile 管理（登记用户填写的兼容端点） |

### 配对鉴权

1. 客户端读取服务端配对码（控制台输出或 `{data_dir}/pairing.json`）；
2. `POST /v1/pair {"pairingCode": "..."}` → `{token, tokenType, expiresAt, ...}`；
3. 后续请求携带 `Authorization: Bearer <token>`。

配对码使用常量时间比较；连续失败达到阈值后短时锁定。令牌仅存于进程内存，
重启后需重新配对；日志不输出令牌本体。

### 统一翻译接口

```jsonc
// POST /v1/translate
{
  "requestId": "request-example-1",
  "sourceLanguage": "en",
  "targetLanguage": "zh-CN",
  "segments": [{ "id": "paragraph-1", "text": "Hello, world." }],
  "profileId": "local-companion-service"   // 可选，缺省用默认 Profile
}
```

响应与请求**严格对齐**（段落 ID 不重复、不遗漏、不混入未知 ID），
批量部分失败时逐段返回 `error: {code, message}`。对齐规则与
`packages/contracts/src/alignment.ts` 完全一致（含
`ALIGNMENT_MISMATCH` 与逐段兜底）。

**翻译转发适配器**（按 `protocol` 解析，不伪装兼容）：

| protocol | 适配器 | 端点拼接 |
| --- | --- | --- |
| `ollama` | Ollama 原生 | `{baseUrl}/api/chat`（baseUrl 已含 `/api` 时只补 `/chat`） |
| `openai-chat` | Chat Completions 兼容 | `{baseUrl}/chat/completions`（保留 `/v1` 等网关前缀） |
| `custom-translate` | 内置混合引擎 | 完全本地，无网络请求 |

- 超出 `limits.maxBatchSize` 自动分批，结果按原始顺序合并；
- 成功译文写入进程内缓存，键含 profileId/revision/引擎/语言对/策略版本；
- 错误映射：连接失败→`NETWORK_ERROR`，超时→`TIMEOUT`，401/403→`AUTH_FAILED`，
  404→`MODEL_UNAVAILABLE`，429→`RATE_LIMITED`，其余 4xx→`INVALID_REQUEST`，5xx→`NETWORK_ERROR`。

### 服务配置 Profile

内置种子（与 contracts mock 对齐，可被用户配置覆盖）：

- `local-companion-service`：`custom-translate`，device-only，内置混合引擎；
- `local-ollama-qwen`：`ollama`，`http://127.0.0.1:11434`，device-only。

用户自定义端点（本地 vLLM、自建网关、云端 BYOK）通过
`PUT /v1/providers/{profileId}` 登记，持久化到 `{data_dir}/providers.json`。
凭据推荐 `secretRef` + 环境变量 `TRANSLATE_SECRET_<REF>` 解析，避免明文落盘。

## 文档解析与导出

`POST /v1/documents/parse` 输出统一的 `DocumentUnit` 列表，保留定位信息：

| 格式 | 单元类型 | 保留信息 |
| --- | --- | --- |
| TXT | `paragraph` | 按行/空行分段，阅读顺序 |
| Markdown | `heading`/`list-item`/`code`/`paragraph` | 标题级别；代码块默认不翻译 |
| DOCX | `heading`/`paragraph`/`list-item`/`table-cell` | 标题级别、样式名、表格行列 |
| PDF | `page-text` | **页码 + bbox `[x,y,width,height]` + 阅读顺序**（PyMuPDF） |
| SRT/VTT | `subtitle-cue` | `startTime`/`endTime` 时间轴 |

无文本层且含图像的 PDF 标记 `requiresOcr=true`，应转 `document-ocr` 长任务。

`POST /v1/documents/export` 支持 `markdown`/`docx`，三种排版：
`bilingual`（对照阅读：译文 + 灰色原文）、`translation-only`、`source-only`；
标题级别、列表与表格结构在导出时重组。

## 长任务（OCR / ASR / 文件翻译）

```
POST /v1/jobs {type, input, sessionId?, sessionGeneration?}   → 201 JobDescriptor
GET  /v1/jobs/{id}                                            → JobDescriptor
POST /v1/jobs/{id}/cancel                                     → JobDescriptor(cancelled)
GET  /v1/jobs/{id}/events                                     → SSE 进度事件
```

- 任务在 asyncio 中后台执行，受 `max_concurrent_jobs` 并发上限控制；
- 进度经 `JobProgressEvent`（`pending → processing → completed/failed/cancelled`）上报；
- 取消为协作式：先置取消事件并等待 `job_cancel_grace_seconds`，超时后强制取消；
- 同一 `sessionId` 的高代次任务创建时，自动取消同会话的低代次活跃任务；
- 输入按任务类型由 Pydantic 模型严格校验（非法 Base64、缺字段在创建时即 422）。

| 任务类型 | 输入 | 输出 |
| --- | --- | --- |
| `document-ocr` | `OcrRequest` | `OcrResponse`（`OcrBlock`：文字 + bbox + 阅读顺序） |
| `video-asr` | `AsrRequest` | `AsrResponse`（`AsrCue`：startTime/endTime + 文本） |
| `file-translation` | 文件 Base64 + 语言对 + 导出选项 | 翻译结果 + 双语文档导出 |
| `batch-translation` | `TranslationRequest` | `TranslationResponse` |

**OCR 引擎**（`LOCAL_SERVICE_OCR_ENGINE`）：`auto`（默认，优先 tesseract，
缺失时用确定性引擎）| `tesseract` | `mock`。
tesseract 词级结果按行聚合为契约块。未安装依赖/二进制时返回
`MODEL_UNAVAILABLE` 并说明缺什么，**绝不静默改用云端识别**。

**ASR 引擎**（`LOCAL_SERVICE_ASR_ENGINE`）：`auto`（优先 whisper.cpp，
其次 faster-whisper，最后确定性引擎）| `whisper-cpp` | `faster-whisper` | `mock`。

- whisper.cpp：子进程调用（`-oj` JSON 输出），需
  `LOCAL_SERVICE_WHISPER_BINARY` 与 `LOCAL_SERVICE_ASR_MODEL_PATH`（ggml 权重）；
- faster-whisper：需 `pip install faster-whisper`（可选依赖 `.[asr]`）；
- 音频始终在本机处理（临时文件 + 子进程/本地库），不经过网络出口；
- 模型缺失时任务失败并返回 `MODEL_UNAVAILABLE`（与 contracts 的 mock 失败样例一致）；
- **分块语义**：每个 `video-asr` 请求承载一个音频分块，返回该分块的
  `AsrCue` 序列；同一 `mediaSessionId` 的多个分块由调用方按 `generation`
  代次管理（代次提升时同会话的低代次任务会被自动取消）。

## 离线与数据合规

`GET /v1/offline/status` 报告：

- `offlineCapable`：已声明能力（文本翻译/OCR/ASR）是否都有可用本地引擎；
- `localEnginesAvailable` / `declaredCapabilities`：按能力对比声明与就绪情况；
- `engines[]`：逐 Profile 的协议、数据策略、地址分类与**实际处理位置**
  （地址只能给出拓扑分类，真实位置以配置声明为准，不可推断时记为 `unverified`）；
- `egress`：出口流量统计（loopback/lan/cloud/blocked）；
- `warnings`：如 "device-only 但实际处理位置非本地" 等配置冲突。

`POST /v1/offline/verify` 执行检查：回环绑定、出口守卫生效、
device-only 配置一致、本地翻译冒烟测试。

**无静默外网回退保证**：所有引擎出站请求都必须经过
`NetworkGuard`——

- 回环地址：始终允许；
- 局域网私有地址：仅 `allow-lan`/`allow-cloud` 策略；
- 公网地址：仅 `allow-cloud` 策略**且**用户显式设置
  `LOCAL_SERVICE_ALLOW_CLOUD_EGRESS=true`；
- `LOCAL_SERVICE_OFFLINE_MODE=true`：除回环外一律拒绝。

被拒绝的请求直接以 `POLICY_VIOLATION` 终止任务并说明原因；
服务不会用自动切换供应商掩盖本地引擎不可用。

## 配置（环境变量，前缀 `LOCAL_SERVICE_`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LOCAL_SERVICE_HOST` / `LOCAL_SERVICE_PORT` | `127.0.0.1` / `8765` | 监听地址（非回环需显式允许） |
| `LOCAL_SERVICE_ALLOW_NON_LOOPBACK_BIND` | `false` | 允许非回环绑定（不推荐） |
| `LOCAL_SERVICE_DATA_DIR` | `%LOCALAPPDATA%\translate-local-service` | 数据目录 |
| `LOCAL_SERVICE_PAIRING_CODE` | 自动生成 | 固定配对码 |
| `LOCAL_SERVICE_TOKEN_TTL_SECONDS` | `86400` | 令牌有效期 |
| `LOCAL_SERVICE_DEFAULT_PROFILE_ID` | `local-companion-service` | 默认翻译配置 |
| `LOCAL_SERVICE_ALLOW_CLOUD_EGRESS` | `false` | 用户显式授权公网出口 |
| `LOCAL_SERVICE_OFFLINE_MODE` | `false` | 离线模式（禁止一切非回环出口） |
| `LOCAL_SERVICE_TRANSLATION_CACHE_TTL_SECONDS` | `900` | 翻译缓存 TTL（0 关闭） |
| `LOCAL_SERVICE_MAX_CONCURRENT_JOBS` | `2` | 并发长任务上限 |
| `LOCAL_SERVICE_JOB_CANCEL_GRACE_SECONDS` | `2.0` | 协作取消等待时长 |
| `LOCAL_SERVICE_OCR_ENGINE` | `auto` | OCR 引擎选择 |
| `LOCAL_SERVICE_TESSERACT_BINARY` | 查 PATH | tesseract 路径 |
| `LOCAL_SERVICE_ASR_ENGINE` | `auto` | ASR 引擎选择 |
| `LOCAL_SERVICE_WHISPER_BINARY` | 无 | whisper.cpp 可执行文件 |
| `LOCAL_SERVICE_ASR_MODEL_PATH` | 无 | ggml 模型权重路径 |
| `LOCAL_SERVICE_OFFLINE_PROBE` | `true` | 自检时探测回环引擎连通性 |
| `LOCAL_SERVICE_LOG_LEVEL` | `INFO` | 日志级别 |

## 代码结构

```
services/local/
├── pyproject.toml
├── local_service/
│   ├── app.py                 # FastAPI 工厂 + 统一错误信封
│   ├── settings.py            # 配置（回环绑定校验、离线模式约束）
│   ├── state.py               # 服务容器（app.state.services）
│   ├── security.py            # 配对码 / Bearer 令牌 / 失败锁定
│   ├── netguard.py            # 网络出口守卫（数据合规核心）
│   ├── cache.py               # 翻译缓存（契约缓存隔离维度）
│   ├── profiles.py            # Profile 存储（内置种子 + providers.json）
│   ├── translation_service.py # 翻译编排（路由/策略/分批/缓存/对齐）
│   ├── recognition.py         # OCR/ASR 引擎选择
│   ├── offline.py             # 离线自检与验证
│   ├── models/                # 契约 Pydantic 模型（与 TS contracts 对齐）
│   ├── engines/               # 翻译引擎（builtin / ollama / openai-chat）
│   ├── documents/             # 解析（txt/md/docx/pdf/srt）与导出（md/docx）
│   ├── ocr/ asr/              # OCR / ASR 引擎适配
│   ├── jobs/                  # 长任务管理器与处理器
│   └── api/                   # 路由与鉴权依赖
└── tests/                     # pytest（77 个用例）
```

## 测试

```bash
python -m pytest          # 全量
python -m pytest -q tests/test_jobs.py -k cancel   # 单个场景
```

覆盖：契约模型与对齐逻辑、配对鉴权与锁定、`/v1/translate`
（契约 mock 样本、策略拒绝、协议不支持、Ollama 适配器与错误映射）、
文档解析/导出（TXT/Markdown/DOCX/PDF 坐标/SRT、MD/DOCX 往返）、
长任务（创建/轮询/取消/SSE/文件翻译全流程）、离线自检与出口守卫。

测试默认使用确定性引擎（`ocr_engine=mock`、`asr_engine=mock`）与
临时数据目录，不依赖外部模型与网络。
