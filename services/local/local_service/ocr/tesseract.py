"""Tesseract OCR 适配器（本地引擎，可选依赖 pytesseract + tesseract 二进制）。

通过 pytesseract 的 ``image_to_data`` 获取词级边界框，再按行聚合为
契约的 OcrBlock（含 bbox 与阅读顺序）。未安装依赖或二进制时
``available=False``，调用方会得到明确的 MODEL_UNAVAILABLE 错误。
"""

from __future__ import annotations

import shutil

from ..models import AppError, ErrorCode, OcrBlock, OcrRequest, OcrResponse
from .base import OcrEngine, assign_reading_order, decode_image


class TesseractOcrEngine(OcrEngine):
    """基于 tesseract 的本地 OCR 引擎。"""

    def __init__(self, binary: str | None = None) -> None:
        self._binary = binary
        self._pytesseract = None
        self._PilImage = None
        self._load_error: str | None = None
        try:
            import pytesseract  # type: ignore
            from PIL import Image  # type: ignore

            self._pytesseract = pytesseract
            self._PilImage = Image
            if binary:
                pytesseract.pytesseract.tesseract_cmd = binary
        except ImportError as exc:
            self._load_error = f"缺少 OCR 依赖 pytesseract/Pillow: {exc}"

    @property
    def engine_id(self) -> str:
        return "tesseract/local"

    @property
    def available(self) -> bool:
        if self._load_error:
            return False
        binary = self._binary or "tesseract"
        return shutil.which(binary) is not None

    def unavailable_reason(self) -> str | None:
        if self._load_error:
            return self._load_error
        return (
            "未找到 tesseract 可执行文件：请安装 tesseract OCR "
            "（或通过 LOCAL_SERVICE_TESSERACT_BINARY 指定路径）"
        )

    async def recognize(self, request: OcrRequest) -> OcrResponse:
        self.ensure_available()
        assert self._pytesseract is not None and self._PilImage is not None

        payload, mime_type = decode_image(request.image_data)
        import io

        try:
            image = self._PilImage.open(io.BytesIO(payload))
        except Exception as exc:  # noqa: BLE001
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                f"无法解码图像数据: {exc}",
                {"mimeType": request.mime_type or mime_type},
            ) from exc

        lang = request.source_language or "eng"
        try:
            data = self._pytesseract.image_to_data(
                image, lang=lang, output_type=self._pytesseract.Output.DICT
            )
        except Exception as exc:  # noqa: BLE001
            raise AppError(
                ErrorCode.MODEL_UNAVAILABLE,
                f"tesseract 识别失败: {exc}",
                {"engine": self.engine_id},
            ) from exc

        # 词级结果按 (block, par, line) 聚合成行级块
        groups: dict[tuple[int, int, int], dict] = {}
        count = len(data.get("text", []))
        for index in range(count):
            text = (data["text"][index] or "").strip()
            if not text:
                continue
            try:
                confidence = float(data["conf"][index])
            except (KeyError, TypeError, ValueError):
                confidence = -1.0
            key = (
                int(data.get("block_num", [0] * count)[index]),
                int(data.get("par_num", [0] * count)[index]),
                int(data.get("line_num", [0] * count)[index]),
            )
            left = int(data["left"][index])
            top = int(data["top"][index])
            width = int(data["width"][index])
            height = int(data["height"][index])
            group = groups.setdefault(
                key,
                {
                    "texts": [],
                    "x0": left,
                    "y0": top,
                    "x1": left + width,
                    "y1": top + height,
                    "confidence": [],
                },
            )
            group["texts"].append(text)
            group["x0"] = min(group["x0"], left)
            group["y0"] = min(group["y0"], top)
            group["x1"] = max(group["x1"], left + width)
            group["y1"] = max(group["y1"], top + height)
            if confidence >= 0:
                group["confidence"].append(confidence)

        blocks: list[OcrBlock] = []
        for index, group in enumerate(groups.values()):
            confidence_values = group["confidence"]
            blocks.append(
                OcrBlock(
                    id=f"ocr-{index:04d}",
                    bbox=(
                        float(group["x0"]),
                        float(group["y0"]),
                        float(group["x1"] - group["x0"]),
                        float(group["y1"] - group["y0"]),
                    ),
                    text=" ".join(group["texts"]),
                    readingOrder=index,
                    confidence=(
                        round(sum(confidence_values) / len(confidence_values) / 100.0, 4)
                        if confidence_values
                        else None
                    ),
                )
            )

        assign_reading_order(blocks, sort_key=lambda b: (b.bbox[1], b.bbox[0]))
        return OcrResponse(requestId=request.request_id, blocks=blocks)
