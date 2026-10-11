"""双语文档导出器：Markdown / DOCX。

- ``bilingual``（默认，对照阅读）：译文段落 + 原文段落（灰色斜体）；
- ``translation-only``：仅译文；
- ``source-only``：仅原文；
- 标题保留级别，列表保留项目符号，表格按 tableId/rowIndex 重组为双列表格。
"""

from __future__ import annotations

import base64
import io
import re

from ..models import AppError, ErrorCode
from .models import DocumentExportRequest, ExportFormat, ExportLayout, ExportUnit

MARKDOWN_MIME = "text/markdown"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

_EXTENSIONS: dict[str, str] = {"markdown": "md", "docx": "docx"}
_MIME_TYPES: dict[str, str] = {"markdown": MARKDOWN_MIME, "docx": DOCX_MIME}


def _slugify(value: str, fallback: str) -> str:
    slug = re.sub(r"[^0-9A-Za-z一-龥_-]+", "-", value).strip("-")
    return slug[:60] or fallback


def _source_text(unit: ExportUnit) -> str:
    return unit.text or ""


def _translation_text(unit: ExportUnit) -> str:
    if unit.translation is not None and unit.translation.strip():
        return unit.translation.strip()
    return _source_text(unit)


def _primary_text(unit: ExportUnit, layout: ExportLayout) -> str:
    if layout == "source-only":
        return _source_text(unit)
    return _translation_text(unit)


# ---------------------------------------------------------------- Markdown
def export_markdown(request: DocumentExportRequest) -> str:
    layout = request.layout
    lines: list[str] = []
    if request.title:
        lines.append(f"# {request.title}")
        lines.append("")

    index = 0
    units = request.units
    while index < len(units):
        unit = units[index]
        if unit.kind == "table-cell":
            # 聚合同一表格的连续单元格
            table_id = unit.table_id or f"table-{index}"
            group: list[ExportUnit] = []
            while index < len(units) and units[index].kind == "table-cell" and (
                units[index].table_id or f"table-{index}"
            ) == table_id:
                group.append(units[index])
                index += 1
            lines.extend(_render_markdown_table(group, layout))
            lines.append("")
            continue

        if unit.kind == "heading":
            level = min(max(unit.level or 1, 1), 6)
            lines.append(f"{'#' * level} {_primary_text(unit, layout)}")
            lines.append("")
        elif unit.kind == "list-item":
            lines.append(f"- {_primary_text(unit, layout)}")
        elif unit.kind == "code":
            lines.append("```")
            lines.append(_source_text(unit))
            lines.append("```")
            lines.append("")
        else:
            lines.append(_primary_text(unit, layout))
            lines.append("")
            if layout == "bilingual" and _translation_text(unit) != _source_text(unit):
                quoted = "\n".join(f"> {ln}" for ln in _source_text(unit).splitlines())
                lines.append(quoted)
                lines.append("")
        index += 1

    text = "\n".join(lines).rstrip() + "\n"
    return text


def _render_markdown_table(group: list[ExportUnit], layout: ExportLayout) -> list[str]:
    rows: dict[int, dict[int, ExportUnit]] = {}
    for unit in group:
        rows.setdefault(unit.row_index or 0, {})[unit.column_index or 0] = unit
    ordered_rows = [rows[key] for key in sorted(rows)]
    header = ["原文", "译文"] if layout != "translation-only" else ["译文"]
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * len(header)) + " |"]
    for row in ordered_rows:
        cells = [row[key] for key in sorted(row)]
        if layout == "translation-only":
            values = [_translation_text(cell) for cell in cells]
        elif layout == "source-only":
            values = [_source_text(cell) for cell in cells]
        else:
            values = [f"{_source_text(cell)} → {_translation_text(cell)}" for cell in cells]
        lines.append("| " + " | ".join(values) + " |")
    return lines


# ---------------------------------------------------------------- DOCX
def export_docx(request: DocumentExportRequest) -> bytes:
    try:
        import docx
        from docx.shared import Pt, RGBColor
    except ImportError as exc:  # pragma: no cover - 依赖已在 pyproject 声明
        raise AppError(
            ErrorCode.OFFLINE_REQUIRED,
            "缺少 DOCX 导出依赖 python-docx，请安装后重试",
        ) from exc

    layout = request.layout
    document = docx.Document()

    if request.title:
        document.add_heading(request.title, level=0)

    def add_source_note(text: str) -> None:
        """原文以灰色小字附在译文之后（对照阅读）。"""
        paragraph = document.add_paragraph()
        run = paragraph.add_run(text)
        run.italic = True
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(0x80, 0x80, 0x80)

    index = 0
    units = request.units
    while index < len(units):
        unit = units[index]
        if unit.kind == "table-cell":
            table_id = unit.table_id or f"table-{index}"
            group: list[ExportUnit] = []
            while index < len(units) and units[index].kind == "table-cell" and (
                units[index].table_id or f"table-{index}"
            ) == table_id:
                group.append(units[index])
                index += 1
            rows: dict[int, dict[int, ExportUnit]] = {}
            for cell in group:
                rows.setdefault(cell.row_index or 0, {})[cell.column_index or 0] = cell
            ordered_rows = [rows[key] for key in sorted(rows)]
            columns = max((len(row) for row in ordered_rows), default=1)
            table = document.add_table(rows=len(ordered_rows), cols=columns)
            for r, row in enumerate(ordered_rows):
                for c in range(columns):
                    cell = row.get(c)
                    if cell is None:
                        continue
                    value = _translation_text(cell) if layout != "source-only" else _source_text(cell)
                    table.cell(r, c).text = value
            document.add_paragraph("")
            continue

        primary = _primary_text(unit, layout)
        if unit.kind == "heading":
            document.add_heading(primary, level=min(max(unit.level or 1, 1), 6))
            if layout == "bilingual" and _translation_text(unit) != _source_text(unit):
                add_source_note(_source_text(unit))
        elif unit.kind == "list-item":
            document.add_paragraph(primary, style="List Bullet")
            if layout == "bilingual" and _translation_text(unit) != _source_text(unit):
                add_source_note(_source_text(unit))
        elif unit.kind == "code":
            paragraph = document.add_paragraph()
            run = paragraph.add_run(_source_text(unit))
            run.font.name = "Consolas"
            run.font.size = Pt(9)
        else:
            document.add_paragraph(primary)
            if layout == "bilingual" and _translation_text(unit) != _source_text(unit):
                add_source_note(_source_text(unit))
        index += 1

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


# ---------------------------------------------------------------- 统一入口
def export_document(request: DocumentExportRequest) -> tuple[bytes, ExportFormat, str, str]:
    """导出文档，返回 (文件字节, 格式, MIME, 文件名)。"""
    if request.format == "markdown":
        content = export_markdown(request).encode("utf-8")
    elif request.format == "docx":
        content = export_docx(request)
    else:  # pragma: no cover - Literal 已约束
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            f"不支持的导出格式: {request.format}",
        )

    title = request.title or f"bilingual-{request.request_id}"
    filename = f"{_slugify(title, 'bilingual-document')}.{_EXTENSIONS[request.format]}"
    return content, request.format, _MIME_TYPES[request.format], filename


def encode_base64(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")
