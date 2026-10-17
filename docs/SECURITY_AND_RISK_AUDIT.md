# 译舟 (TransArk) - 安全审计与风险防范报告

本文档梳理「译舟 (TransArk)」在**浏览器扩展**、**云端字幕服务**、**本地伴随服务**三个部署面上的安全边界、潜在风险与已落地防护。当前实现以方案 A（云端翻译 + 云端 ASR）为主，本地伴随服务作为独立后端保留。

---

## 目录

1. [扩展权限与应用商店合规](#1-扩展权限与应用商店合规)
2. [云端服务：鉴权、滥用与 SSRF](#2-云端服务鉴权滥用与-ssrf)
3. [本地伴随服务：CSRF 与路径遍历](#3-本地伴随服务csrf-与路径遍历)
4. [数据出口与静默回退](#4-数据出口与静默回退)
5. [提示词注入与输出对齐](#5-提示词注入与输出对齐)
6. [DOM 挂载与 XSS](#6-dom-挂载与-xss)
7. [敏感信息与运维检查清单](#7-敏感信息与运维检查清单)

---

## 1. 扩展权限与应用商店合规

### 潜在风险

- `manifest.json` 申请了 `<all_urls>`、`tabCapture`、`offscreen`、`scripting` 等高敏感权限。
- Chrome Web Store 执行单一用途与最小权限原则；权限理由不足会被拒审或下架。
- 用户担忧扩展读取登录表单、支付信息或私人消息。

### 已落地措施

1. **输入与脚本标签过滤**：`dom-walker.ts` 的 `IGNORED_TAGS` 跳过 `INPUT`、`TEXTAREA`、`SELECT`、`BUTTON`、`SCRIPT`、`PRE` 等，不采集用户输入。
2. **零远程代码**：React、图标、样式与业务逻辑全部打包进扩展，产物约 **463 kB**，不加载外部 CDN 脚本。
3. **最小化字幕抓取面**：Background 仅代理 `https://*.youtube.com/api/timedtext`，不做通用 URL 代理。

### 加固建议

- 正式上架时将 `host_permissions` 收敛为 `activeTab` + 按需申请目标域名；
- 为 `tabCapture` / `offscreen` 增加更明确的用户提示与单次授权说明；
- 对 `content_scripts` 评估是否仅注入白名单站点。

---

## 2. 云端服务：鉴权、滥用与 SSRF

### 潜在风险

- 公网暴露的翻译/ASR 接口可能被脚本批量滥用，消耗 Provider 配额。
- Provider Key 若落盘或下发客户端，会直接泄露第三方账号。
- 字幕 URL 抓取接口可能被用于 SSRF，探测云厂商元数据或内网服务。
- 明文 HTTP 会导致 Key、字幕与音频被中间人窃取。

### 已落地措施

1. **API Key 鉴权**：`CLOUD_API_KEYS` 逗号分隔，`secrets.compare_digest` 常量时间比较；WS 通过 `start` 帧或 `?token=` 携带。
2. **限流与降级**：按 Key 滑动窗口/固定窗口限流；Redis 不可用时熔断回退进程内，不阻断正常请求。
3. **Provider Key 仅驻留内存**：云端使用 `ProfileStore(..., persist=False)`，启动配置中的 `apiKey` 不写入 `providers.json`；客户端只拿到云端 API Key。
4. **SSRF 防护**：`/v1/subtitles/extract` 的 URL 模式拒绝回环/私有网段，重定向逐跳复检（最多 4 跳）；扩展侧仅允许 YouTube timedtext。
5. **错误信封**：统一 `{error:{code,message}}`，不返回堆栈与密钥；日志不打印 Authorization。
6. **部署要求**：生产必须由 Nginx/Caddy 终止 TLS；`CLOUD_ALLOW_ANONYMOUS` 保持 `false`。

### 加固建议

- 多实例部署启用 Redis 限流，按租户/Key 做配额与账单；
- 为字幕 URL 抓取增加域名白名单或人工审核；
- 接入 WAF/网关级 body 大小与超时限制；
- 定期轮换 `CLOUD_API_KEYS` 与 Provider Key。

---

## 3. 本地伴随服务：CSRF 与路径遍历

> 范围说明：`services/local` 是独立后端，扩展当前不直接调用。本节风险仅在该服务被部署并暴露给调用方时成立。

### 潜在风险

- 恶意网页对 `127.0.0.1:8765` 发起跨源盲打，滥用本地 CPU/GPU 或读取任务结果。
- 若接口接受任意文件系统路径，可能通过 `../../` 读取敏感文件。

### 已落地措施

1. **配对码 + Bearer**：8 位配对码（`secrets.choice` 生成）+ 内存令牌；`secrets.compare_digest` 常量时间比较；连续失败锁定。
2. **强制回环绑定**：默认 `127.0.0.1`，非回环绑定需显式设置 `LOCAL_SERVICE_ALLOW_NON_LOOPBACK_BIND=true`。
3. **不接收文件路径**：文档/字幕接口使用 Base64 内容，不接受宿主绝对路径；ASR 临时文件写入 `tempfile.TemporaryDirectory` 并在结束后销毁。
4. **出口守卫**：`NetworkGuard` 按 `device-only` / `allow-lan` / `allow-cloud` 与 `offline_mode` 校验出站请求，拒绝时抛 `POLICY_VIOLATION`。

### 加固建议

- 增加 `Sec-Fetch-Site` / Origin 校验中间件；
- 若对外暴露，必须置于反向代理与额外鉴权之后；
- 定期审计 `providers.json` 中的凭据引用方式（推荐 `secretRef`）。

---

## 4. 数据出口与静默回退

### 风险

- 用户误以为“本地翻译”，实际原文/音频已上传云端。
- 供应商故障时静默切换，导致数据流向不明或重复计费。

### 已落地措施

1. **扩展不自动切换**：只请求当前 Profile 的 BaseUrl；流式失败仅在 `INTERNAL_ERROR`/`NETWORK_ERROR` 时回退同供应商的非流式请求，鉴权/限流错误原样抛出。
2. **云端不自动切换 Provider**：按 `profileId` 选择；未配置则报错，不做隐式回退。
3. **本地服务 NetworkGuard**：离线/`device-only` 下阻断非回环出站，并记录出口统计。
4. **数据去向披露**：README 与 `SECURITY.md` 明确说明云端字幕/翻译会上传原文、字幕或音频。

### 残余风险

- 扩展本身没有出口守卫；用户把 BaseUrl 配成恶意地址时，数据会发往该地址。
- 云端运营方仍可看到明文请求内容；敏感场景应使用自建云端或方案 B（本机 ASR）。

---

## 5. 提示词注入与输出对齐

### 风险

- 网页正文可能包含“忽略之前的指令”等对抗性文本，诱导模型输出脚本或泄露系统提示词。

### 已落地措施

1. **结构化输出约束**：系统提示词要求仅返回 `{"segments":[{"id","translation"}]}`，禁止解释性文本。
2. **严格 ID 对齐**：`validateTranslationAlignment` 校验 requestId、重复 ID、缺失 ID 与未知 ID；缺失段落降级为 `ALIGNMENT_MISMATCH` 错误段。
3. **不执行模型输出**：译文只作为纯文本渲染，不进入 `eval`、`innerHTML` 或脚本上下文。

### 残余风险

- 模型仍可能被诱导产生错误译文或超长输出；对齐校验保证结构，不保证语义正确。
- 建议对高风险站点增加输出长度与字符集限制。

---

## 6. DOM 挂载与 XSS

### 风险

- 若用 `innerHTML` 渲染译文，恶意页面可注入 `<img onerror=...>` 执行脚本。

### 已落地措施

1. **`textContent` 写入**：网页译文容器与视频字幕浮层均只使用 `textContent`。
2. **独立节点挂载**：译文以兄弟节点追加，不修改宿主 DOM 结构与事件监听。
3. **Shadow DOM 隔离**：字幕浮层使用 Shadow DOM，避免宿主样式污染，也避免字幕节点被页面脚本误操作。
4. **原文哈希校验**：FNV-1a 哈希不一致时丢弃陈旧译文，避免把旧译文贴到新内容上。

---

## 7. 敏感信息与运维检查清单

- [x] 源码与文档不包含真实 API Key（仅占位符）；
- [x] `.gitignore` 覆盖 `.env`、`*.key`、`__pycache__`、`.pytest_cache`、`.workbuddy/` 等；
- [x] 云端 Provider Key 不落盘（`ProfileStore(persist=False)`）；
- [x] 扩展 API Key 不注入网页 DOM；
- [x] 日志不打印 Authorization / Provider Key；
- [x] 云端错误统一信封，不返回堆栈；
- [ ] 生产环境 TLS、强 Key、限流、出站白名单需部署方落实；
- [ ] 第三方依赖与镜像需定期漏洞扫描；
- [ ] 站点适配器新增抓取域名需经过白名单评审。

---

## 附：验证入口

- 扩展单测：`pnpm --filter @translate/extension test`
- 云端安全相关测试：`cd services/cloud && python -m pytest tests/test_auth.py tests/test_subtitles.py`
- 本地服务安全测试：`cd services/local && python -m pytest tests/test_security.py tests/test_netguard.py`
- 部署与排错：[`SERVER_DEPLOYMENT.md`](./SERVER_DEPLOYMENT.md)
