"""FastAPI 依赖：鉴权与服务定位。"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..models import AppError, ErrorCode
from ..security import PairingService, TokenInfo
from ..state import AppServices

_bearer_scheme = HTTPBearer(auto_error=False, description="配对令牌（POST /v1/pair 获取）")


def get_services(request: Request) -> AppServices:
    services: AppServices | None = getattr(request.app.state, "services", None)
    if services is None:  # pragma: no cover - 应用未正确初始化
        raise AppError(ErrorCode.INTERNAL_ERROR, "服务未初始化")
    return services


def get_pairing(services: Annotated[AppServices, Depends(get_services)]) -> PairingService:
    return services.pairing


async def require_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    services: Annotated[AppServices, Depends(get_services)],
) -> TokenInfo:
    """校验 Bearer 配对令牌（/v1/pair 与 /health 之外的端点均需鉴权）。"""
    if credentials is None or not credentials.credentials:
        raise AppError(
            ErrorCode.AUTH_FAILED,
            "缺少 Authorization: Bearer <token>，请先调用 POST /v1/pair 配对",
        )
    return services.pairing.verify(credentials.credentials)


CurrentToken = Annotated[TokenInfo, Depends(require_token)]
Services = Annotated[AppServices, Depends(get_services)]
