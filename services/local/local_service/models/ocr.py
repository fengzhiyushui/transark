"""OCR 契约模型（与 packages/contracts/src/ocr.ts 对齐）。"""

from __future__ import annotations

from pydantic import Field, field_validator

from .base import ContractModel, ensure_base64_payload

# 归一化或像素坐标边界框 [x, y, width, height]
Bbox = tuple[float, float, float, float]


class OcrBlock(ContractModel):
    """OCR 识别文字块单元。"""

    id: str = Field(description="文本块唯一标识")
    bbox: Bbox = Field(description="边界框 [x, y, width, height]")
    text: str = Field(description="识别出的文本内容")
    reading_order: int = Field(ge=0, description="阅读排版顺序编号（0 起始）")
    confidence: float | None = Field(default=None, ge=0.0, le=1.0, description="置信度")
    page_number: int | None = Field(default=None, ge=1, description="所属页面页码")


class OcrRequest(ContractModel):
    """OCR 提取请求。"""

    request_id: str
    image_data: str = Field(description="Base64 图像数据或 data URI")
    mime_type: str | None = Field(default=None, description="图像 MIME 类型")
    source_language: str | None = Field(default=None, description="期望的识别语言")

    @field_validator("image_data")
    @classmethod
    def _validate_image_data(cls, value: str) -> str:
        return ensure_base64_payload(value, field="imageData")


class OcrResponse(ContractModel):
    """OCR 提取响应。"""

    request_id: str
    blocks: list[OcrBlock]
    detected_language: str | None = None
