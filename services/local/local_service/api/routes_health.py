"""健康检查端点（无需鉴权）。"""

from __future__ import annotations

import time

from fastapi import APIRouter
from pydantic import Field

from ..models.base import ContractModel
from .deps import Services

router = APIRouter(tags=["health"])

_STARTED_AT = time.time()


class HealthResponse(ContractModel):
    """健康检查响应。"""

    status: str = "ok"
    service: str = "local-companion-service"
    version: str
    host: str
    port: int
    loopback_only: bool
    uptime_seconds: float = Field(ge=0)
    active_jobs: int = Field(ge=0)
    pairing_required: bool = True


@router.get(
    "/health",
    response_model=HealthResponse,
    response_model_exclude_none=True,
    summary="健康检查",
)
async def health(services: Services) -> HealthResponse:
    settings = services.settings
    return HealthResponse(
        version=_version(),
        host=settings.host,
        port=settings.port,
        loopbackOnly=settings.is_loopback,
        uptimeSeconds=round(time.time() - _STARTED_AT, 3),
        activeJobs=services.jobs.active_count,
    )


def _version() -> str:
    from .. import __version__

    return __version__
