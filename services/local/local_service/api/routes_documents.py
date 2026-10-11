"""文档解析与导出端点。"""

from __future__ import annotations

from fastapi import APIRouter

from ..documents import (
    DocumentExportRequest,
    DocumentExportResponse,
    DocumentParseRequest,
    DocumentParseResponse,
)
from .deps import CurrentToken, Services

router = APIRouter(prefix="/v1/documents", tags=["documents"])


@router.post(
    "/parse",
    response_model=DocumentParseResponse,
    response_model_exclude_none=True,
    summary="文档解析",
    description=(
        "支持 TXT / Markdown / DOCX 解析为结构化段落单元；"
        "支持带坐标（bbox）与阅读顺序的 PDF 文本提取；"
        "无文本层的扫描 PDF 会标记 requiresOcr=true（转 document-ocr 长任务）。"
    ),
)
async def parse_document(
    request: DocumentParseRequest,
    services: Services,
    _token: CurrentToken,
) -> DocumentParseResponse:
    return await services.documents.parse(request)


@router.post(
    "/export",
    response_model=DocumentExportResponse,
    response_model_exclude_none=True,
    summary="双语文档导出",
    description="将双语结果重组导出为 Markdown 或 DOCX 文件（Base64 返回）。",
)
async def export_document(
    request: DocumentExportRequest,
    services: Services,
    _token: CurrentToken,
) -> DocumentExportResponse:
    return await services.documents.export(request)
