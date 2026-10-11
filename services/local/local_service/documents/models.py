"""文档解析 / 导出契约模型。

这些端点属于本项目专用契约（接入文档"Document/Media Worker"能力接口），
与 packages/contracts 的字段风格（camelCase、严格校验）保持一致。
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from ..models.base import ContractModel, ensure_base64_payload
from ..models.ocr import Bbox

DocumentFormat = Literal["txt", "markdown", "docx", "pdf", "srt", "vtt", "unknown"]
UnitKind = Literal[
    "paragraph",
    "heading",
    "list-item",
    "code",
    "table-cell",
    "subtitle-cue",
    "page-text",
]
ExportFormat = Literal["markdown", "docx"]
ExportLayout = Literal["bilingual", "translation-only", "source-only"]


class DocumentUnit(ContractModel):
    """结构化文档单元（段落 / 标题 / 列表项 / 表格单元格 / 字幕 cue）。

    定位信息按接入文档要求保留：页码、块 ID、阅读顺序与版面坐标。
    """

    id: str = Field(description="单元唯一标识")
    text: str = Field(description="单元文本")
    kind: UnitKind = "paragraph"
    level: int | None = Field(default=None, ge=1, le=6, description="标题级别")
    page_number: int | None = Field(default=None, ge=1, description="页码（PDF）")
    bbox: Bbox | None = Field(default=None, description="版面坐标 [x, y, width, height]")
    reading_order: int | None = Field(default=None, ge=0, description="阅读顺序（0 起始）")
    style_name: str | None = Field(default=None, description="原始样式名（DOCX）")
    table_id: str | None = Field(default=None, description="所属表格标识")
    row_index: int | None = Field(default=None, ge=0)
    column_index: int | None = Field(default=None, ge=0)
    start_time: float | None = Field(default=None, ge=0.0, description="字幕开始时间（秒）")
    end_time: float | None = Field(default=None, ge=0.0, description="字幕结束时间（秒）")
    translatable: bool = Field(default=True, description="是否参与翻译")


class ParseOptions(ContractModel):
    """解析选项。"""

    encoding: str = Field(default="utf-8", description="文本类文件编码")
    max_units: int = Field(default=5000, ge=1, le=50000, description="单元数量上限")
    include_code_blocks: bool = Field(default=True, description="是否保留代码块单元")


class DocumentParseRequest(ContractModel):
    """文档解析请求（文件内容以 Base64 传输，支持 data URI 前缀）。"""

    request_id: str
    filename: str | None = Field(default=None, description="原始文件名（用于格式识别）")
    mime_type: str | None = Field(default=None, description="MIME 类型")
    data: str = Field(description="Base64 文件内容")
    source_language: str | None = Field(default=None, description="期望的源语言")
    options: ParseOptions | None = None

    @field_validator("data")
    @classmethod
    def _validate_data(cls, value: str) -> str:
        return ensure_base64_payload(value, field="data")


class DocumentParseResponse(ContractModel):
    """文档解析响应。"""

    request_id: str
    format: DocumentFormat = "unknown"
    units: list[DocumentUnit] = []
    unit_count: int = 0
    pages: int | None = Field(default=None, ge=1, description="PDF 页数")
    title: str | None = Field(default=None, description="文档标题（若可识别）")
    detected_language: str | None = None
    requires_ocr: bool = Field(default=False, description="是否为无文本层的扫描件（需 OCR）")
    warnings: list[str] = []


class ExportUnit(ContractModel):
    """导出单元（原文 + 译文 + 排版信息）。"""

    id: str
    text: str = Field(default="", description="原文")
    translation: str | None = Field(default=None, description="译文")
    kind: UnitKind = "paragraph"
    level: int | None = None
    table_id: str | None = None
    row_index: int | None = None
    column_index: int | None = None


class DocumentExportRequest(ContractModel):
    """双语文档导出请求。"""

    request_id: str
    format: ExportFormat = "markdown"
    title: str | None = None
    layout: ExportLayout = "bilingual"
    units: list[ExportUnit] = Field(min_length=1)
    metadata: dict | None = None


class DocumentExportResponse(ContractModel):
    """双语文档导出响应（文件内容以 Base64 返回）。"""

    request_id: str
    filename: str
    mime_type: str
    data: str = Field(description="Base64 文件内容")
    size_bytes: int = Field(ge=0)
    unit_count: int = Field(ge=0)
    format: ExportFormat
