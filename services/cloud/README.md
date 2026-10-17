# @translate/cloud-service

TransArk 云端服务（**方案 A**）：为浏览器扩展提供字幕翻译、字幕提取与实时 ASR。

> **与扩展的关系**：扩展通过 `CLOUD_API_KEYS` 鉴权调用本服务；第三方 Provider Key 只放在服务端环境变量/启动配置中，且不落盘。
> `services/local` 是独立的本地后端，扩展当前不调用。
>
> 部署到服务器（systemd / Docker / Nginx / 排错）请参阅
> [`docs/SERVER_DEPLOYMENT.md`](../../docs/SERVER_DEPLOYMENT.md)。

## 设计要点

- **服务端不部署大模型**：翻译全部转发到第三方 API（复用 `local_service.engines` 的四种协议适配器：`openai-chat`、`openai-responses`、`anthropic-messages`、`gemini-generate`）。
- **Provider Key 不落盘**：`ProfileStore(persist=False)`，配置只驻留进程内存，重启需重新注入环境变量。
- **ASR 按需加载**：`faster-whisper` 以 int8/CPU 运行，模型权重首次请求时下载到 `HF_HOME`，不打进镜像；模型不可用时明确返回 `MODEL_UNAVAILABLE`，绝不静默降级。
- **缓存优先**：译文按「Provider/版本/引擎/语言对/原文/策略版本」做 SHA-256 键；配置 `CLOUD_REDIS_URL` 时用 Redis，否则退化为进程内 LRU。
- **流式体验**：SSE 逐 cue 下发译文；WS 流式 ASR 每识别出一句即推送，可选内联翻译。
- **契约复用**：请求/响应、错误码、段落严格对齐校验与 `packages/contracts`、`services/local` 保持一致。

## 端点

| 端点 | 鉴权 | 说明 |
| --- | --- | --- |
| `GET /health` | 否 | 健康检查 |
| `POST /v1/translate` | Bearer | 段落翻译（复用本地服务契约） |
| `POST /v1/documents/parse` | Bearer | 文档解析（TXT/MD/DOCX/PDF/SRT/VTT） |
| `POST /v1/documents/export` | Bearer | 双语文档导出 |
| `POST /v1/subtitles/extract` | Bearer | 字幕提取（Base64 / 文本 / 公网 URL） |
| `POST /v1/subtitles/translate` | Bearer | 字幕翻译；`?stream=true` 走 SSE 逐段下发 |
| `WS /v1/asr/stream` | start 帧 / `?token=` | 16kHz PCM → 带时间戳 cue 流，可选内联翻译 |
| `POST /v1/jobs` 等 | Bearer | 长任务（整段音频转写、批量翻译、文件翻译） |

### 字幕翻译（SSE）

```http
POST /v1/subtitles/translate?stream=true
Authorization: Bearer <key>
Content-Type: application/json

{
  "requestId": "req-1",
  "sourceLanguage": "auto",
  "targetLanguage": "zh-CN",
  "segments": [{ "id": "cue-1", "text": "Welcome to the demo." }]
}
```

```
data: {"requestId":"req-1","type":"start"}
data: {"requestId":"req-1","type":"segment","segment":{"id":"cue-1","translation":"欢迎观看演示。"}}
data: {"requestId":"req-1","type":"done","response":{...}}
data: [DONE]
```

### 流式 ASR（WebSocket）

```jsonc
// 客户端首帧
{ "type": "start", "sessionId": "s-1", "sampleRate": 16000,
  "sourceLanguage": "en", "targetLanguage": "zh-CN", "token": "<key>" }
// 之后发送二进制 PCM（16kHz 单声道 int16）
// 服务端事件
{ "type": "started", "sessionId": "s-1" }
{ "type": "cue", "sessionId": "s-1", "cue": { "id": "cue-0001", "startTime": 0.0, "endTime": 2.8, "text": "..." } }
{ "type": "translation", "sessionId": "s-1", "cueId": "cue-0001", "translation": "..." }
{ "type": "final", "sessionId": "s-1", "durationSec": 612.4 }
// 结束时客户端发送 { "type": "stop" }
```

## 运行

```bash
cd services/cloud
pip install -e ../local -e ".[dev]"     # 复用 local_service 内核
export CLOUD_API_KEYS=dev-key
export CLOUD_PROVIDER_API_KEY=sk-...
python -m cloud_service                  # 0.0.0.0:8780
```

Docker：

```bash
cd services/cloud
CLOUD_API_KEYS=dev-key CLOUD_PROVIDER_API_KEY=sk-... docker compose up --build
```

## 环境变量（前缀 `CLOUD_`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CLOUD_HOST` / `CLOUD_PORT` | `0.0.0.0` / `8780` | 监听地址 |
| `CLOUD_API_KEYS` | 空 | 逗号分隔的客户端 Key；为空且 `ALLOW_ANONYMOUS=false` 时拒绝所有请求 |
| `CLOUD_ALLOW_ANONYMOUS` | `false` | 仅开发模式使用 |
| `CLOUD_RATE_LIMIT_RPM` | `60` | 每 Key 每分钟请求上限 |
| `CLOUD_DEFAULT_PROFILE_ID` | `cloud-default` | 默认翻译 Profile |
| `CLOUD_PROVIDER_PROTOCOL` | `openai-chat` | 默认 Provider 协议 |
| `CLOUD_PROVIDER_BASE_URL` | `https://api.deepseek.com/v1` | 默认 Provider BaseUrl |
| `CLOUD_PROVIDER_MODEL` | `deepseek-chat` | 默认模型 |
| `CLOUD_PROVIDER_API_KEY` | 空 | Provider 密钥（仅服务端） |
| `CLOUD_PROVIDERS_JSON` | 空 | 完整 Provider 配置数组（多 Provider 时优先） |
| `CLOUD_ASR_ENGINE` | `faster-whisper` | `faster-whisper` / `whisper-cpp` / `mock`（测试） |
| `CLOUD_ASR_MODEL_ID` | `base` | tiny/base/small/medium… |
| `CLOUD_ASR_CHUNK_SECONDS` | `5.0` | 流式转写窗口 |
| `CLOUD_ASR_OVERLAP_SECONDS` | `0.5` | 窗口重叠（去重衔接） |
| `CLOUD_REDIS_URL` | 空 | 配置后启用 Redis 缓存 |
| `CLOUD_CACHE_TTL_SECONDS` | `86400` | 译文缓存 TTL |
| `CLOUD_CACHE_MAX_ENTRIES` | `10000` | 无 Redis 时的进程内缓存上限 |
| `CLOUD_MAX_CONCURRENT_JOBS` | `4` | 长任务并发 |

## 扩展性

- API 无状态，可直接水平扩容；WS 连接由网关/负载均衡按连接粘性转发。
- 配置 `CLOUD_REDIS_URL` 后，限流使用 Redis 固定窗口计数，多实例共享配额；Redis 异常时自动熔断回退进程内限流，不阻断翻译。
- ASR worker 与 API 同镜像不同启动参数；生产建议按队列深度独立扩容，GPU 档位单独部署。
- 降级顺序：限流 → 排队（返回 ETA）→ 切换轻量模型/备用 Provider；不静默切换。

## 测试

```bash
python -m pytest
python scripts/smoke_e2e.py --spawn   # 真实 HTTP + WebSocket 冒烟（echo + mock ASR）
```

覆盖：API Key 鉴权与限流、字幕提取、SSE 流式翻译、WS ASR（mock 引擎）、错误信封。

`smoke_e2e.py` 也支持对接已部署服务：

```bash
python scripts/smoke_e2e.py --base-url https://cloud.example.com --api-key <key>
```
