"""配对握手与服务能力端点。"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import __version__
from ..engines import SUPPORTED_PROTOCOLS
from ..models.base import ContractModel
from ..security import PairRequest, PairResponse
from .deps import Services, get_pairing

router = APIRouter(prefix="/v1", tags=["pairing"])


class CapabilitiesResponse(ContractModel):
    """服务能力声明（固定能力端点，供扩展侧能力发现）。"""

    service: str = "local-companion-service"
    version: str
    protocols: list[str]
    job_types: list[str]
    document_formats: list[str]
    export_formats: list[str]
    ocr: bool = True
    asr: bool = True
    async_jobs: bool = True
    streaming: bool = False
    data_policy_default: str = "device-only"


@router.post(
    "/pair",
    response_model=PairResponse,
    response_model_exclude_none=True,
    summary="配对握手",
)
async def pair(request: PairRequest, pairing=Depends(get_pairing)) -> PairResponse:
    """凭配对码换取 Bearer 令牌（后续 /v1/* 请求需携带）。"""
    return pairing.pair(
        request.pairing_code,
        client_id=request.client_id,
        client_name=request.client_name,
    )


@router.get("/capabilities", response_model=CapabilitiesResponse, summary="服务能力声明")
async def capabilities(services: Services) -> CapabilitiesResponse:
    return CapabilitiesResponse(
        version=__version__,
        protocols=list(SUPPORTED_PROTOCOLS),
        jobTypes=services.jobs.supported_types,
        documentFormats=["txt", "markdown", "docx", "pdf", "srt", "vtt"],
        exportFormats=["markdown", "docx"],
    )
