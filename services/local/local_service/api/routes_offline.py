"""离线自检端点（数据合规保障）。"""

from __future__ import annotations

from fastapi import APIRouter

from ..offline import OfflineStatusResponse, OfflineVerifyResponse
from .deps import CurrentToken, Services

router = APIRouter(prefix="/v1/offline", tags=["offline"])


@router.get(
    "/status",
    response_model=OfflineStatusResponse,
    response_model_exclude_none=True,
    summary="离线自检状态",
    description=(
        "报告当前模型是否完全在本地运行：逐引擎列出实际处理位置、"
        "本地资源就绪情况与出口流量统计。服务不会在未经用户授权下静默向外网回退。"
    ),
)
async def offline_status(services: Services, _token: CurrentToken) -> OfflineStatusResponse:
    return await services.offline.status()


@router.post(
    "/verify",
    response_model=OfflineVerifyResponse,
    response_model_exclude_none=True,
    summary="离线验证",
    description="执行离线资格检查（回环绑定、出口守卫、device-only 一致性、本地翻译冒烟）。",
)
async def offline_verify(services: Services, _token: CurrentToken) -> OfflineVerifyResponse:
    return await services.offline.verify()
