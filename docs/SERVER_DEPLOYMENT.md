# 云端服务部署教程（方案 A）

本文档说明如何把 `services/cloud` 部署到一台 Linux 服务器，供浏览器扩展调用字幕翻译与流式 ASR。命令默认在仓库根目录执行。

## 1. 部署形态与资源建议

| 形态 | 适用场景 | 说明 |
| --- | --- | --- |
| 裸机 + systemd | 单台长期运行 | 最简单，便于挂载模型缓存 |
| Docker Compose | 快速交付 / 带 Redis | 一条命令启动 app + Redis |
| 多实例 + 负载均衡 | 生产高可用 | API 无状态；WS 需连接粘性；限流用 Redis |

资源建议（经验值，按并发调整）：

- **仅翻译（无 ASR）**：2 vCPU / 2GB 内存即可；主要瓶颈是第三方 API 配额与网络。
- **ASR（faster-whisper base，CPU）**：4 vCPU / 4–8GB 内存；`small` 以上建议 GPU。
- **磁盘**：系统 + 依赖约 2GB；模型缓存按档位 0.1–1.5GB。
- **网络**：需能访问模型下载源（HuggingFace）与你配置的第三方翻译 API。

## 2. 运行环境

- Linux（amd64/arm64），Python **3.11+**；
- `ffmpeg`（faster-whisper 解码音频所需）；
- Redis 7+（可选，多实例限流/缓存）；
- Nginx / Caddy（生产建议，负责 TLS 与 WebSocket 转发）；
- 已开放 443（或 8780 仅内网）。

## 3. 安装依赖

```bash
sudo apt-get update
sudo apt-get install -y python3.11 python3.11-venv ffmpeg

git clone <your-repo> transark && cd transark
python3.11 -m venv .venv
source .venv/bin/activate

# 关键：cloud 复用 local_service 内核，必须先安装 local
pip install -e ./services/local
pip install -e "./services/cloud[asr,cache]"
```

> `services/cloud` 的 `pyproject.toml` 没有把 `local_service` 声明为 PyPI 依赖，因此必须按上面的顺序安装；只装 cloud 会在启动时报 `ModuleNotFoundError: local_service`。

如需运行测试：`pip install -e "./services/cloud[dev]"`。

## 4. 配置项

所有配置通过环境变量注入，前缀 `CLOUD_`。

### 4.1 核心配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CLOUD_HOST` | `0.0.0.0` | 监听地址；容器内保持 `0.0.0.0` |
| `CLOUD_PORT` | `8780` | 监听端口 |
| `CLOUD_API_KEYS` | 空 | 逗号分隔的客户端 Key；**为空且未开匿名时拒绝所有请求** |
| `CLOUD_ALLOW_ANONYMOUS` | `false` | 仅本地调试使用，生产必须 `false` |
| `CLOUD_RATE_LIMIT_RPM` | `60` | 每个 Key 每分钟请求上限 |
| `CLOUD_DATA_DIR` | `%LOCALAPPDATA%/transark-cloud` 或 `~/.local/share/transark-cloud` | 配置/缓存持久化目录 |
| `CLOUD_LOG_LEVEL` | `INFO` | 日志级别 |
| `CLOUD_MAX_CONCURRENT_JOBS` | `4` | 长任务并发 |

### 4.2 翻译 Provider

单 Provider（最简）：

```bash
export CLOUD_PROVIDER_PROTOCOL=openai-chat
export CLOUD_PROVIDER_BASE_URL=https://api.deepseek.com/v1
export CLOUD_PROVIDER_MODEL=deepseek-chat
export CLOUD_PROVIDER_API_KEY=sk-xxxx
export CLOUD_DEFAULT_PROFILE_ID=cloud-default
```

多 Provider（推荐生产使用）：`CLOUD_PROVIDERS_JSON` 传完整配置数组，字段与 `packages/contracts` 一致（camelCase）：

```bash
export CLOUD_PROVIDERS_JSON='[
  {
    "profileId": "deepseek-chat",
    "revision": 1,
    "name": "DeepSeek Chat",
    "protocol": "openai-chat",
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "auth": { "type": "bearer", "apiKey": "sk-xxxx" },
    "dataPolicy": "allow-cloud",
    "processingLocation": "cloud",
    "capabilities": { "textTranslation": true, "streaming": true, "structuredOutput": true },
    "enabled": true
  },
  {
    "profileId": "claude",
    "revision": 1,
    "name": "Claude",
    "protocol": "anthropic-messages",
    "baseUrl": "https://api.anthropic.com/v1",
    "model": "claude-3-5-sonnet-20241022",
    "auth": { "type": "api-key", "apiKey": "sk-ant-xxxx" },
    "dataPolicy": "allow-cloud",
    "processingLocation": "cloud",
    "capabilities": { "textTranslation": true, "streaming": true, "structuredOutput": true },
    "enabled": true
  }
]'
export CLOUD_DEFAULT_PROFILE_ID=deepseek-chat
```

扩展请求时可通过 `profileId` 选择 Provider；未指定则用 `CLOUD_DEFAULT_PROFILE_ID`。

> Provider 配置（含 `apiKey`）只驻留进程内存，**不会写入 `providers.json`**；重启后需重新注入环境变量。请将环境文件权限设为 `600`，避免密钥被同机其他用户读取。

### 4.3 ASR

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CLOUD_ASR_ENGINE` | `faster-whisper` | `faster-whisper` / `whisper-cpp` / `mock`（仅测试） |
| `CLOUD_ASR_MODEL_ID` | `base` | tiny/base/small/medium… |
| `CLOUD_ASR_CHUNK_SECONDS` | `5.0` | 流式转写窗口 |
| `CLOUD_ASR_OVERLAP_SECONDS` | `0.5` | 窗口重叠（去重衔接） |
| `CLOUD_WHISPER_BINARY` | 空 | whisper.cpp 可执行文件（选用 whisper-cpp 时） |
| `CLOUD_ASR_MODEL_PATH` | 空 | ggml 模型路径（选用 whisper-cpp 时） |

模型首次使用会下载到 `HF_HOME`；容器部署建议挂载持久卷并设置 `HF_HOME=/models/hf`。国内网络可设置 `HF_ENDPOINT=https://hf-mirror.com`。

### 4.4 缓存与 Redis

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CLOUD_REDIS_URL` | 空 | 如 `redis://127.0.0.1:6379/0`；配置后启用 Redis 缓存与共享限流 |
| `CLOUD_CACHE_TTL_SECONDS` | `86400` | 译文缓存 TTL；`0` 关闭 |
| `CLOUD_CACHE_MAX_ENTRIES` | `10000` | 进程内缓存上限（无 Redis 时） |

Redis 不可用时服务自动回退进程内缓存/限流，不会中断翻译；日志会出现 warning。

## 5. 启动方式

### 5.1 直接启动

```bash
export CLOUD_HOST=0.0.0.0 CLOUD_PORT=8780
export CLOUD_API_KEYS="$(openssl rand -hex 16)"
export CLOUD_PROVIDER_API_KEY=sk-xxxx
python -m cloud_service
```

生产环境请把环境变量放入 `/etc/transark/cloud.env`，不要写进 shell 历史。

### 5.2 systemd

`/etc/systemd/system/transark-cloud.service`：

```ini
[Unit]
Description=TransArk Cloud Service
After=network.target

[Service]
Type=simple
User=transark
Group=transark
WorkingDirectory=/opt/transark/services/cloud
EnvironmentFile=/etc/transark/cloud.env
ExecStart=/opt/transark/.venv/bin/python -m cloud_service
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now transark-cloud
sudo systemctl status transark-cloud
journalctl -u transark-cloud -f
```

### 5.3 Docker Compose

```bash
cd services/cloud
cat > .env <<'EOF'
CLOUD_API_KEYS=replace-with-strong-key
CLOUD_PROVIDER_BASE_URL=https://api.deepseek.com/v1
CLOUD_PROVIDER_MODEL=deepseek-chat
CLOUD_PROVIDER_API_KEY=sk-xxxx
CLOUD_ASR_ENGINE=faster-whisper
CLOUD_ASR_MODEL_ID=base
EOF

docker compose up -d --build
docker compose logs -f cloud
```

Compose 会同时启动 Redis，并把 `/data`、`/models` 挂载为持久卷。首次 ASR 会下载模型，启动后前几秒可能较慢。

## 6. Nginx 反向代理（TLS + SSE + WebSocket）

```nginx
server {
    listen 443 ssl http2;
    server_name translate.example.com;

    ssl_certificate     /etc/letsencrypt/live/translate.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/translate.example.com/privkey.pem;

    client_max_body_size 30m;   # 字幕 Base64 会膨胀约 1/3

    location / {
        proxy_pass http://127.0.0.1:8780;
        proxy_http_version 1.1;

        # WebSocket（/v1/asr/stream）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        # SSE 必须关闭缓冲，否则逐 cue 下发改成整批
        proxy_buffering off;
        proxy_cache off;
        gzip off;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Caddy 等价配置：

```caddy
translate.example.com {
    reverse_proxy 127.0.0.1:8780
}
```

Caddy 默认支持 WebSocket；SSE 建议显式 `flush_interval -1`。

## 7. 部署验证

### 7.1 健康检查

```bash
curl -s https://translate.example.com/health | jq
```

应返回 `status: ok`、`loopbackOnly: false`、`activeJobs` 等字段。

### 7.2 字幕提取与翻译

```bash
KEY=replace-with-strong-key

# 1) 提取（Base64 SRT）
SRT=$(printf '1\n00:00:01,000 --> 00:00:03,500\nHello world.\n' | base64 -w0)
curl -s https://translate.example.com/v1/subtitles/extract \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"requestId\":\"t1\",\"filename\":\"a.srt\",\"data\":\"$SRT\"}" | jq

# 2) 批量翻译
curl -s https://translate.example.com/v1/subtitles/translate \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"requestId":"t2","sourceLanguage":"en","targetLanguage":"zh-CN","segments":[{"id":"c1","text":"Hello world."}]}' | jq

# 3) SSE 流式（应看到 data: {...} 与 [DONE]）
curl -N "https://translate.example.com/v1/subtitles/translate?stream=true" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"requestId":"t3","sourceLanguage":"en","targetLanguage":"zh-CN","segments":[{"id":"c1","text":"Hello world."}]}'
```

### 7.3 一键冒烟

```bash
cd services/cloud
# 对接已部署服务
python scripts/smoke_e2e.py --base-url https://translate.example.com --api-key "$KEY"
# 或本机自启（echo + mock，不需要外部 Key）
python scripts/smoke_e2e.py --spawn
```

### 7.4 扩展端联调

1. 打开扩展 Options →「常规偏好」→ 云端字幕与 ASR；
2. 填写 `https://translate.example.com` 与同一个 `CLOUD_API_KEYS`；
3. 打开一个带 `<video>` 的页面，Popup 开启「视频双语字幕」；
4. 无字幕视频应在数秒内出现原文 cue，随后出现译文。

## 8. 常见问题排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `401 AUTH_FAILED` | Key 不一致 / 未带 Header | 检查 `CLOUD_API_KEYS` 与扩展配置；确认 `Authorization: Bearer <key>` |
| `403 POLICY_VIOLATION` | 字幕 URL 指向回环/私网 | 只允许公网 http(s) 字幕地址；这是 SSRF 防护 |
| `429 RATE_LIMITED` | 超过 RPM / 多实例各自计数 | 调大 `CLOUD_RATE_LIMIT_RPM`；多实例务必配置 Redis |
| `503 MODEL_UNAVAILABLE` | faster-whisper 未安装 / 模型下载失败 | `pip install faster-whisper`、安装 ffmpeg、检查 `HF_HOME`/网络 |
| `502 NETWORK_ERROR` | 第三方 API 不可达 / BaseUrl 错 | 在服务器上 `curl` 供应商端点；检查 `CLOUD_PROVIDER_BASE_URL` |
| SSE 一次性返回 / 卡住 | Nginx 缓冲 | 确认 `proxy_buffering off`、`X-Accel-Buffering: no` |
| WebSocket 400 / 1006 | 未转发 Upgrade / 超时 | 补 `Upgrade`/`Connection` 头，`proxy_read_timeout 3600s` |
| 上传字幕 `413` | 请求体超过 Nginx 限制 | 调大 `client_max_body_size`（Base64 膨胀） |
| Redis 连接 warning | URL 错 / Redis 未启动 | 服务会回退进程内；修复 `CLOUD_REDIS_URL` 后重启 |
| 首次 ASR 很慢 | 模型下载 | 预下载模型或挂载模型卷；可设 `HF_ENDPOINT` 镜像 |
| 容器健康检查失败 | 端口/绑定错误 | 容器内 `CLOUD_HOST=0.0.0.0`，确认 8780 监听 |
| 扩展报 CORS | 直接用网页调用（非扩展） | 扩展 Background 不受 CORS 限制；网页调用需自行加 CORS 中间件 |

## 9. 安全与运维清单

- 必须启用 HTTPS；不要把 8780 直接暴露公网。
- `CLOUD_API_KEYS` 使用高强度随机值，定期轮换；Provider Key 只放服务端。
- 生产关闭 `CLOUD_ALLOW_ANONYMOUS`。
- 限制服务器出站访问，仅放行所需 Provider 域名与模型下载源。
- 日志不打印 Key；如接入网关，开启请求体大小与超时限制。
- 备份 `CLOUD_DATA_DIR`（Provider 配置/缓存元数据）；模型缓存可重建。
- 扩容：API 无状态可水平扩展；WS 需负载均衡连接粘性；ASR 按 CPU 核数/队列深度扩容。
- 升级：先在小流量实例验证 `/health` 与冒烟，再滚动替换；保留上一版本镜像/虚拟环境以便回滚。

## 10. 相关文档

- 云端服务端点与环境变量：[`services/cloud/README.md`](../services/cloud/README.md)
- 视频字幕支持范围：[`docs/VIDEO_SUBTITLE_SUPPORT.md`](./VIDEO_SUBTITLE_SUPPORT.md)
- 方案 B（浏览器端 WASM ASR）：[`docs/PLAN_B_BROWSER_WASM_ASR.md`](./PLAN_B_BROWSER_WASM_ASR.md)
