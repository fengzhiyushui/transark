"""文档解析器：TXT / Markdown / DOCX / PDF（含坐标）/ SRT / VTT。

设计要点：
- 输出统一的 :class:`DocumentUnit` 列表，保留阅读顺序与定位信息；
- PDF 使用 PyMuPDF 提取文本块及像素/点坐标（bbox = [x, y, width, height]）；
  无文本层且包含图像的页面标记 ``requiresOcr=True``（转 OCR 长任务）；
- DOCX 按 body 顺序遍历段落与表格，保留标题级别与表格结构；
- 所有解析为纯 CPU 本地操作，无任何网络请求。
"""

from __future__ import annotations

import base64
import binascii
import re
from typing import Any

from ..models import AppError, ErrorCode
from .models import DocumentParseRequest, DocumentUnit, DocumentFormat

_MIME_FORMAT_MAP = {
    "text/plain": "txt",
    "text/markdown": "markdown",
    "text/x-markdown": "markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/pdf": "pdf",
    "application/x-subrip": "srt",
    "text/srt": "srt",
    "text/vtt": "vtt",
}

_EXT_FORMAT_MAP = {
    ".txt": "txt",
    ".md": "markdown",
    ".markdown": "markdown",
    ".docx": "docx",
    ".pdf": "pdf",
    ".srt": "srt",
    ".vtt": "vtt",
}


# ---------------------------------------------------------------- base64 工具
def decode_base64(data: str, *, field: str = "data") -> bytes:
    """解码 Base64（容忍 data URI 前缀与空白）。"""
    text = data.strip()
    if text.startswith("data:"):
        _, _, comma = text.partition(",")
        text = comma
    try:
        return base64.b64decode(re.sub(r"\s+", "", text), validate=False)
    except (binascii.Error, ValueError) as exc:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            f"字段 {field!r} 不是合法的 Base64 内容",
            {"field": field},
        ) from exc


def detect_format(request: DocumentParseRequest, payload: bytes) -> str:
    """按 MIME → 扩展名 → 魔数的优先级识别格式。"""
    if request.mime_type:
        fmt = _MIME_FORMAT_MAP.get(request.mime_type.strip().lower())
        if fmt:
            return fmt
    if request.filename:
        lower = request.filename.lower()
        for ext, fmt in _EXT_FORMAT_MAP.items():
            if lower.endswith(ext):
                return fmt
    if payload.startswith(b"%PDF-"):
        return "pdf"
    if payload.startswith(b"PK\x03\x04"):
        return "docx"
    return "txt"


# ---------------------------------------------------------------- TXT / MD
def parse_text(text: str, *, options) -> list[DocumentUnit]:
    """TXT：按空行分段；段内多个连续行各自成为独立单元（翻译粒度更细）。"""
    units: list[DocumentUnit] = []
    index = 0
    paragraphs = re.split(r"\n\s*\n", text)
    for para in paragraphs:
        lines = [line.strip() for line in para.splitlines() if line.strip()]
        for content in lines:
            if not content:
                continue
            units.append(
                DocumentUnit(
                    id=f"p-{index:04d}",
                    text=content,
                    kind="paragraph",
                    readingOrder=index,
                )
            )
            index += 1
            if len(units) >= options.max_units:
                return units
    return units


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_LIST_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(.*)$")
_FENCE_RE = re.compile(r"^\s*```")


def parse_markdown(text: str, *, options) -> list[DocumentUnit]:
    """Markdown：标题 / 列表 / 代码块 / 段落。"""
    units: list[DocumentUnit] = []
    index = 0
    lines = text.splitlines()
    buffer: list[str] = []
    code_buffer: list[str] = []
    in_code = False

    def flush_paragraph() -> None:
        nonlocal index, buffer
        if not buffer:
            return
        content = "\n".join(buffer).strip()
        buffer = []
        if not content:
            return
        units.append(
            DocumentUnit(
                id=f"md-{index:04d}",
                text=content,
                kind="paragraph",
                readingOrder=index,
            )
        )
        index += 1

    def flush_code() -> None:
        nonlocal index, code_buffer
        if not code_buffer:
            return
        content = "\n".join(code_buffer)
        code_buffer = []
        units.append(
            DocumentUnit(
                id=f"md-{index:04d}",
                text=content,
                kind="code",
                translatable=False,
                readingOrder=index,
            )
        )
        index += 1

    for line in lines:
        if _FENCE_RE.match(line):
            if in_code:
                in_code = False
                if options.include_code_blocks:
                    flush_code()
                else:
                    code_buffer = []
            else:
                flush_paragraph()
                in_code = True
            continue
        if in_code:
            if options.include_code_blocks:
                code_buffer.append(line)
            continue

        heading = _HEADING_RE.match(line)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            content = heading.group(2).strip()
            if content:
                units.append(
                    DocumentUnit(
                        id=f"md-{index:04d}",
                        text=content,
                        kind="heading",
                        level=level,
                        readingOrder=index,
                    )
                )
                index += 1
            continue

        list_item = _LIST_RE.match(line)
        if list_item:
            flush_paragraph()
            content = list_item.group(1).strip()
            if content:
                units.append(
                    DocumentUnit(
                        id=f"md-{index:04d}",
                        text=content,
                        kind="list-item",
                        readingOrder=index,
                    )
                )
                index += 1
            continue

        if not line.strip():
            flush_paragraph()
            continue
        buffer.append(line)

        if len(units) >= options.max_units:
            break

    if in_code and options.include_code_blocks:
        flush_code()
    flush_paragraph()
    return units


# ---------------------------------------------------------------- DOCX
def parse_docx(payload: bytes) -> tuple[list[DocumentUnit], str | None]:
    """DOCX：按 body 顺序遍历段落与表格。"""
    try:
        import docx
        from docx.document import Document as _Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph
    except ImportError as exc:  # pragma: no cover - 依赖已在 pyproject 声明
        raise AppError(
            ErrorCode.OFFLINE_REQUIRED,
            "缺少 DOCX 解析依赖 python-docx，请安装后重试",
        ) from exc

    import io

    try:
        document: _Document = docx.Document(io.BytesIO(payload))
    except Exception as exc:  # noqa: BLE001 - python-docx 对非 zip 内容抛 PackageNotFoundError
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            f"DOCX 解析失败（文件可能已损坏或不是有效的 DOCX）: {exc}",
        ) from exc
    units: list[DocumentUnit] = []
    index = 0
    title: str | None = None

    def add_unit(**kwargs: Any) -> None:
        nonlocal index
        kwargs.setdefault("readingOrder", index)
        kwargs.setdefault("id", f"dx-{index:04d}")
        units.append(DocumentUnit(**kwargs))
        index += 1

    body = document.element.body
    for child in body.iterchildren():
        tag = child.tag.split("}")[-1]
        if tag == "p":
            paragraph = Paragraph(child, document)
            content = paragraph.text.strip()
            if not content:
                continue
            style_name = paragraph.style.name if paragraph.style is not None else None
            level: int | None = None
            kind = "paragraph"
            if style_name and style_name.lower().startswith("heading"):
                kind = "heading"
                match = re.search(r"(\d+)", style_name)
                level = int(match.group(1)) if match else 1
            elif style_name and style_name.lower().startswith("title"):
                kind = "heading"
                level = 1
                title = content
            elif style_name and "list" in style_name.lower():
                kind = "list-item"
            add_unit(text=content, kind=kind, level=level, styleName=style_name)
        elif tag == "tbl":
            table = Table(child, document)
            table_id = f"tbl-{index:04d}"
            for row_index, row in enumerate(table.rows):
                for column_index, cell in enumerate(row.cells):
                    content = cell.text.strip()
                    if not content:
                        continue
                    add_unit(
                        text=content,
                        kind="table-cell",
                        tableId=table_id,
                        rowIndex=row_index,
                        columnIndex=column_index,
                    )
    return units, title


# ---------------------------------------------------------------- PDF
def parse_pdf(payload: bytes) -> tuple[list[DocumentUnit], int, bool]:
    """PDF：提取带坐标的文本块；无文本层的扫描件标记 requiresOcr。"""
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover
        raise AppError(
            ErrorCode.OFFLINE_REQUIRED,
            "缺少 PDF 解析依赖 PyMuPDF，请安装后重试",
        ) from exc

    try:
        document = fitz.open(stream=payload, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            f"PDF 解析失败: {exc}",
        ) from exc

    blocks: list[tuple[int, float, float, str, tuple[float, float, float, float]]] = []
    total_chars = 0
    has_images = False
    page_count = document.page_count

    try:
        for page_number_zero_based in range(page_count):
            page = document[page_number_zero_based]
            page_dict = page.get_text("dict")
            page_chars = 0
            for block in page_dict.get("blocks", []):
                if block.get("type") != 0:  # 1 = 图像块
                    continue
                lines = block.get("lines", [])
                texts: list[str] = []
                for line in lines:
                    for span in line.get("spans", []):
                        span_text = span.get("text", "")
                        if span_text.strip():
                            texts.append(span_text)
                content = "\n".join(texts).strip()
                if not content:
                    continue
                x0, y0, x1, y1 = block.get("bbox", (0.0, 0.0, 0.0, 0.0))
                blocks.append(
                    (
                        page_number_zero_based + 1,
                        float(y0),
                        float(x0),
                        content,
                        (float(x0), float(y0), float(x1 - x0), float(y1 - y0)),
                    )
                )
                page_chars += len(content)
            total_chars += page_chars
            if page.get_images():
                has_images = True
    finally:
        document.close()

    # 阅读顺序：页码 → y 坐标 → x 坐标
    blocks.sort(key=lambda item: (item[0], round(item[1], 1), item[2]))

    units: list[DocumentUnit] = []
    for index, (page_number, _y, _x, content, bbox) in enumerate(blocks):
        units.append(
            DocumentUnit(
                id=f"pdf-{index:04d}",
                text=content,
                kind="page-text",
                pageNumber=page_number,
                bbox=bbox,
                readingOrder=index,
            )
        )

    requires_ocr = total_chars < 20 and has_images
    return units, page_count, requires_ocr


# ---------------------------------------------------------------- SRT / VTT
_TIME_RE = re.compile(
    r"(?P<start>\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(?P<end>\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})"
)


def _parse_timestamp(value: str) -> float:
    hours, minutes, rest = value.split(":")
    seconds, _, fraction = rest.replace(",", ".").partition(".")
    fraction = (fraction + "000")[:3]
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(fraction) / 1000.0


def parse_subtitles(text: str, *, options) -> list[DocumentUnit]:
    """SRT / VTT：按 cue 解析，保留起止时间轴。"""
    units: list[DocumentUnit] = []
    lines = text.splitlines()
    index = 0
    buffer: list[str] = []
    timing: tuple[float, float] | None = None

    def flush_cue() -> None:
        nonlocal index, buffer, timing
        if timing is None:
            buffer = []
            return
        content = "\n".join(buffer).strip()
        buffer = []
        if not content:
            timing = None
            return
        start, end = timing
        units.append(
            DocumentUnit(
                id=f"cue-{index:04d}",
                text=content,
                kind="subtitle-cue",
                startTime=start,
                endTime=end,
                readingOrder=index,
            )
        )
        index += 1
        timing = None

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            flush_cue()
            continue
        if line.upper().startswith("WEBVTT") or line.startswith("NOTE"):
            continue
        match = _TIME_RE.search(line)
        if match:
            flush_cue()
            timing = (
                _parse_timestamp(match.group("start")),
                _parse_timestamp(match.group("end")),
            )
            continue
        if re.fullmatch(r"\d+", line) and timing is None:
            continue  # SRT 序号行
        buffer.append(line)
        if len(units) >= options.max_units:
            break

    flush_cue()
    return units


# ---------------------------------------------------------------- 统一入口
def parse_document(
    request: DocumentParseRequest,
) -> tuple[DocumentFormat, list[DocumentUnit], dict]:
    """解析文档，返回 (格式, 单元列表, 附加信息)。"""
    from .models import ParseOptions

    payload = decode_base64(request.data)
    fmt = detect_format(request, payload)
    options = request.options or ParseOptions()

    extra: dict = {"warnings": []}

    if fmt in ("txt", "markdown"):
        encoding = options.encoding
        try:
            text = payload.decode(encoding)
        except (UnicodeDecodeError, LookupError) as exc:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                f"无法以 {encoding} 解码文本文件: {exc}",
            ) from exc
        units = parse_text(text, options=options) if fmt == "txt" else parse_markdown(
            text, options=options
        )
    elif fmt == "docx":
        units, title = parse_docx(payload)
        if title:
            extra["title"] = title
    elif fmt == "pdf":
        units, pages, requires_ocr = parse_pdf(payload)
        extra["pages"] = pages
        extra["requiresOcr"] = requires_ocr
        if requires_ocr:
            extra["warnings"].append(
                "未检测到文本层，判定为扫描件：请改用 document-ocr 长任务处理"
            )
    elif fmt in ("srt", "vtt"):
        text = payload.decode(options.encoding, errors="replace")
        units = parse_subtitles(text, options=options)
    else:  # pragma: no cover
        units = []

    return fmt, units, extra  # type: ignore[return-value]
