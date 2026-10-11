"""确定性 OCR 引擎（测试 / 离线演示用）。

- 输入图像经 PIL 解码，输出与输入规模匹配的块布局；
- 文本来自内置脚本表（与 packages/contracts/src/mock.ts 的 OCR mock 对齐），
  未命中时返回明确的占位文本，保证输出始终符合 OcrBlock 契约。
"""

from __future__ import annotations

from ..models import OcrBlock, OcrRequest, OcrResponse
from .base import OcrEngine, assign_reading_order, decode_image

_SCRIPTED_BLOCKS: list[dict] = [
    {
        "text": "CHAPTER 1: INTRODUCTION",
        "bbox": (32, 48, 320, 40),
        "confidence": 0.99,
    },
    {
        "text": "Offline document processing keeps intellectual property and sensitive corporate data within local boundaries.",
        "bbox": (32, 100, 560, 180),
        "confidence": 0.96,
    },
    {
        "text": "Both text PDF files and scanned image documents can be parsed through reading order layout reconstruction.",
        "bbox": (32, 290, 560, 90),
        "confidence": 0.94,
    },
]


class MockOcrEngine(OcrEngine):
    """确定性 OCR 引擎（本地、无外部依赖）。"""

    def __init__(self, scripted_blocks: list[dict] | None = None) -> None:
        self._blocks = scripted_blocks if scripted_blocks is not None else _SCRIPTED_BLOCKS

    @property
    def engine_id(self) -> str:
        return "mock/deterministic-ocr"

    async def recognize(self, request: OcrRequest) -> OcrResponse:
        # 解码以验证输入是合法图像（与真实引擎行为一致）
        payload, _mime = decode_image(request.image_data)
        try:
            from PIL import Image  # type: ignore

            image = Image.open(__import__("io").BytesIO(payload))
            width, height = image.size
        except Exception:  # noqa: BLE001 - 非图像输入时退化为默认布局
            width, height = 612, 792

        blocks = [
            OcrBlock(
                id=f"ocr-block-{index + 1:03d}",
                bbox=tuple(item["bbox"]),  # type: ignore[arg-type]
                text=item["text"],
                readingOrder=index,
                confidence=item.get("confidence"),
                pageNumber=1,
            )
            for index, item in enumerate(self._blocks)
        ]
        if not blocks:
            blocks = [
                OcrBlock(
                    id="ocr-block-001",
                    bbox=(0.0, 0.0, float(width), float(height)),
                    text="",
                    readingOrder=0,
                    confidence=0.0,
                    pageNumber=1,
                )
            ]
        assign_reading_order(blocks, sort_key=lambda b: (b.bbox[1], b.bbox[0]))
        return OcrResponse(requestId=request.request_id, blocks=blocks, detectedLanguage="en")
