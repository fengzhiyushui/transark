"""内置混合引擎（built-in hybrid）。

- 完全本地运行，无任何网络请求（device-only 的默认引擎）；
- 内置契约 mock 样本短语表：对 packages/contracts/src/mock.ts 中的
  示例文本返回示例译文，使服务在无外部模型时也可完成端到端冒烟与测试；
- 其余文本返回确定性伪译文（``[目标语言] 原文``），保证对齐与可重复性。
"""

from __future__ import annotations

from ..models import TranslationRequest, TranslationResponse, TranslationSegmentResult
from .base import TranslationEngine

# 契约 mock 样本 → 契约 mock 译文（见 packages/contracts/src/mock.ts）
_PHRASEBOOK: dict[str, str] = {
    "Hello, world!": "你好，世界！",
    "This is a cross-platform browser translation extension built with Manifest V3 and WXT.": "这是一个采用 Manifest V3 与 WXT 构建的跨平台浏览器翻译扩展。",
    "Offline translation guarantees complete data privacy by keeping all processing on-device.": "离线翻译通过在设备本地完成所有计算处理，确保完整的数据隐私。",
    "Hello world.": "你好，世界。",
    "This is a sample document for translation testing.": "这是一个用于翻译测试的示例文档。",
    "Offline translation preserves your privacy and keeps your data on-device.": "离线翻译保护您的隐私，并将数据保留在设备本地。",
    "Welcome to the offline video translation demo.": "欢迎使用离线视频翻译演示。",
    "This sentence shows speech recognition and bilingual subtitles.": "这句话展示了语音识别与双语字幕。",
}


class BuiltinEngine(TranslationEngine):
    """内置确定性翻译引擎（protocol=custom-translate）。"""

    @property
    def engine_id(self) -> str:
        return f"built-in/{self.profile.model or 'hybrid'}"

    @property
    def actual_location(self) -> str:
        return "local"

    async def translate(self, request: TranslationRequest) -> TranslationResponse:
        results: list[TranslationSegmentResult] = []
        for seg in request.segments:
            translation = _PHRASEBOOK.get(seg.text.strip())
            if translation is None:
                translation = f"[{request.target_language}] {seg.text}"
            results.append(TranslationSegmentResult(id=seg.id, translation=translation))
        return TranslationResponse(
            requestId=request.request_id,
            segments=results,
            resolvedEngine=self.resolved_engine(),
        )
