"""OCR 引擎抽象。

本地 OCR 能力通过适配器接入（tesseract / 其他本地引擎）；
未配置可用引擎时返回明确的 MODEL_UNAVAILABLE / OFFLINE_REQUIRED 错误，
绝不静默降级或改用云端识别。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import AppError, ErrorCode, OcrRequest, OcrResponse


class OcrEngine(ABC):
    """OCR 引擎统一接口：图片/扫描页 → 带坐标与阅读顺序的文字块。"""

    @property
    @abstractmethod
    def engine_id(self) -> str:
        """引擎标识（如 'tesseract/5.3.0'）。"""

    @property
    def is_local(self) -> bool:
        """是否完全本地运行。"""
        return True

    @property
    def available(self) -> bool:
        """引擎当前是否可用（依赖/二进制/模型是否就绪）。"""
        return True

    def unavailable_reason(self) -> str | None:
        return None

    @abstractmethod
    async def recognize(self, request: OcrRequest) -> OcrResponse:
        """执行识别并返回符合契约的 OcrBlock 列表。"""

    # -------------------------------------------------------------- helpers
    def ensure_available(self) -> None:
        if not self.available:
            raise AppError(
                ErrorCode.MODEL_UNAVAILABLE,
                self.unavailable_reason() or f"OCR 引擎不可用: {self.engine_id}",
                {"engine": self.engine_id},
            )


def decode_image(image_data: str) -> tuple[bytes, str | None]:
    """把 Base64 / data URI 图像数据解码为字节流。"""
    import base64
    import binascii
    import re

    mime_type: str | None = None
    text = image_data.strip()
    if text.startswith("data:"):
        header, _, payload = text.partition(",")
        match = re.search(r"data:([^;]+);base64", header)
        if match:
            mime_type = match.group(1)
        text = payload
    try:
        return base64.b64decode(re.sub(r"\s+", "", text), validate=False), mime_type
    except (binascii.Error, ValueError) as exc:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "imageData 不是合法的 Base64 内容",
        ) from exc


def assign_reading_order(blocks: list, *, sort_key=None) -> list:
    """按阅读顺序（默认 y → x）重排并写入 readingOrder。"""
    if sort_key is not None:
        blocks.sort(key=sort_key)
    for index, block in enumerate(blocks):
        block.reading_order = index
    return blocks
