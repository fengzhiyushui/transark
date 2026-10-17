# 视频字幕支持范围与限制

本文档说明 TransArk 视频双语字幕功能**目前适配哪些视频来源**、**其他来源如何回退**，以及已知限制。实现代码位于 `apps/extension/src/subtitles/`。

## 1. 结论速览

- **专用站点适配器目前只有 YouTube 一个**。
- 其他网站并非完全不可用：只要页面使用标准 HTML5 `<video>` 且暴露 `textTracks`，就能直接读取字幕；否则可以**上传 SRT/VTT**，或使用**云端 ASR**（需配置云端服务）。
- **DRM 视频（Netflix / Disney+ / Prime Video 等）不支持**：浏览器不提供可捕获的音频流，也无法读取加密字幕轨。
- **跨域 iframe 内嵌播放器不支持**：Content Script 默认只注入顶层页面，无法访问 iframe 内的 `<video>`。

## 2. 字幕来源与回退顺序

`SubtitleManager.start()` 按以下顺序尝试：

1. `<video>.textTracks` 内嵌字幕轨；
2. 站点适配器（当前：YouTube）；
3. 无字幕 → 云端流式 ASR（需在设置中启用云端服务与“无字幕自动 ASR”）；
4. 任意时刻可由用户通过 Popup「导入字幕」上传 `.srt/.vtt`，覆盖当前字幕。

## 3. 各来源支持矩阵

| 来源 / 站点类型 | 字幕获取 | 双语翻译 | 说明 |
| --- | --- | --- | --- |
| 标准 HTML5 `<track>` / `textTracks` | ✅ | ✅ | 同源或允许 CORS 的轨道可读取 `cue.text`；跨域轨道常返回 `cues = null` |
| YouTube | ✅ 专用适配器 | ✅ | 解析首屏 HTML 的 `captionTracks`，抓取 `timedtext`（json3/XML）；优先手动轨 |
| Bilibili | ❌ 无专用适配器 | 仅 ASR 路径 | 不使用标准 `textTracks`；弹幕不是字幕；可回退云端 ASR |
| Vimeo | ⚠️ 视播放器实现 | ✅ | 若播放器填充了 `textTracks` 可读取；否则回退 ASR |
| 自建 HTML5 播放器 | ⚠️ 视实现 | ✅ | 只要暴露标准 `TextTrack` 即可 |
| Netflix / Disney+ / Prime Video | ❌ | ❌ | Widevine/EME 保护，`tabCapture` 通常无法获取音频 |
| Canvas / WebGL 播放器 | ❌ | ❌ | 页面没有 `<video>` 元素，无法定位播放器与捕获音频 |
| 跨域 iframe 内嵌播放器 | ❌ | ❌ | Content Script 只注入顶层页面（未开启 `all_frames`） |
| 直播流 | ⚠️ 通常无字幕轨 | ✅ | ASR 可用；cue 时间相对“开始捕获”时刻 |
| 单页多个视频 | ✅ 面积最大者 | ✅ | `findPrimaryVideo()` 选择可见面积最大的 `<video>` |

## 4. 关键限制

### 4.1 YouTube 适配器

- 依赖页面首屏 HTML 中的 `ytInitialPlayerResponse.captions...captionTracks`；
- YouTube 是 SPA，站内跳转后首屏 HTML 不会更新，可能需要刷新页面；
- 目前选择“第一条手动轨”，**尚未按目标语言自动选轨**；
- 仅代理抓取 `https://*.youtube.com/api/timedtext`，其他域名一律拒绝（防 SSRF）；
- 需要登录/年龄验证的视频可能拿不到 `captionTracks`。

### 4.2 ASR 路径

- 需要先在 Options 中启用云端服务并填写 Endpoint / API Key；
- 通过 `tabCapture` 捕获**当前标签页**音频，标签页必须处于活动状态；DRM 页面拿不到音频；
- cue 时间从“开始捕获”起算，扩展会加上开启时的 `video.currentTime` 作为基准；
- **播放中拖动进度条不会重新对齐 ASR 时间轴**：建议关闭后重新开启字幕，或等待当前会话结束；
- 音频会上传到云端，敏感内容请使用方案 B（浏览器端 WASM ASR，尚未实施）或不上传。

### 4.3 通用限制

- 跨域字幕轨可能因浏览器安全策略无法读取 `cues`；
- 字幕样式固定为内置高对比度浮层，暂不支持自定义字体/位置；
- 只挂载到面积最大的 `<video>`，多播放器页面需手动扩展；
- 视频容器若为 `overflow: hidden` 且定位特殊，浮层可能被裁剪。

## 5. 如何新增站点适配器

实现 `SiteSubtitleAdapter` 并在 `sources.ts` 注册：

```ts
export interface SiteSubtitleAdapter {
  id: string;
  matches(url: string): boolean;
  fetchCues(video: HTMLVideoElement): Promise<SubtitleCue[] | null>;
}
```

注意事项：

- 适配器运行在 Content Script（隔离世界），不能直接读取页面 JS 变量；需要解析 DOM/HTML，或通过 Background 代理受控请求；
- 若需新增抓取域名，必须在 `background.ts` 的 `FETCH_SUBTITLE_TRACK` 白名单中显式加入，禁止开放通用代理；
- 返回 `null` 表示“不适用”，管道会自动回退到 ASR；
- 新增解析逻辑时补充纯函数单元测试（参考 `tests/subtitles-sites.test.mjs`）。

## 6. 测试现状

- YouTube 轨道提取、选轨、timedtext json3/XML 解析、域名匹配均有单元测试；
- 字幕解析、二分查找、Overlay 渲染、上传管线、ASR 时间偏移均有单元测试；
- **未做真实站点的联网 E2E**（受登录、地区、反爬与 CI 网络限制）。
