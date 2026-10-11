"""文档服务：解析 / 导出的编排层。"""

from __future__ import annotations

import base64
import logging

from .exporters import encode_base64, export_document
from .models import (
    DocumentExportRequest,
    DocumentExportResponse,
    DocumentParseRequest,
    DocumentParseResponse,
)
from .parsers import parse_document

logger = logging.getLogger("local_service.documents")


class DocumentService:
    """文档解析与导出编排（纯本地 CPU 操作，无网络请求）。"""

    async def parse(self, request: DocumentParseRequest) -> DocumentParseResponse:
        fmt, units, extra = parse_document(request)
        warnings = list(extra.get("warnings", []))
        if len(units) >= (request.options.max_units if request.options else 5000):
            warnings.append("已达到单元数量上限，后续内容被截断")
        return DocumentParseResponse(
            requestId=request.request_id,
            format=fmt,
            units=units,
            unitCount=len(units),
            pages=extra.get("pages"),
            title=extra.get("title"),
            detectedLanguage=request.source_language,
            requiresOcr=bool(extra.get("requiresOcr", False)),
            warnings=warnings,
        )

    async def export(self, request: DocumentExportRequest) -> DocumentExportResponse:
        content, fmt, mime_type, filename = export_document(request)
        return DocumentExportResponse(
            requestId=request.request_id,
            filename=filename,
            mimeType=mime_type,
            data=encode_base64(content),
            sizeBytes=len(content),
            unitCount=len(request.units),
            format=fmt,
        )

    @staticmethod
    def decode_export_data(response: DocumentExportResponse) -> bytes:
        return base64.b64decode(response.data)
