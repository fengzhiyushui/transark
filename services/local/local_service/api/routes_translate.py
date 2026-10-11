"""统一翻译端点 POST /v1/translate（接入文档的专用翻译契约）。"""

from __future__ import annotations

from fastapi import APIRouter

from ..models import TranslationRequest, TranslationResponse
from .deps import CurrentToken, Services

router = APIRouter(prefix="/v1", tags=["translation"])


@router.post(
    "/translate",
    response_model=TranslationResponse,
    response_model_exclude_none=True,
    summary="统一翻译接口",
    description=(
        "接收 segments 列表，返回与请求严格对齐的翻译结果。"
        "批量部分失败时逐段返回结构化错误；段落 ID 不重复、不遗漏、不混入未知 ID。"
    ),
)
async def translate(
    request: TranslationRequest,
    services: Services,
    _token: CurrentToken,
) -> TranslationResponse:
    return await services.translation.translate(request)
