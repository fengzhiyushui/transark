"""服务配置 Profile 管理端点（登记"用户填写的兼容端点"）。"""

from __future__ import annotations

from fastapi import APIRouter

from ..models import AppError, ErrorCode, TranslationProviderConfig
from .deps import CurrentToken, Services

router = APIRouter(prefix="/v1/providers", tags=["providers"])


@router.get("", response_model=list[TranslationProviderConfig], summary="列出服务配置")
async def list_providers(services: Services, _token: CurrentToken) -> list[TranslationProviderConfig]:
    return services.profiles.all()


@router.get(
    "/{profile_id}",
    response_model=TranslationProviderConfig,
    summary="获取服务配置",
)
async def get_provider(profile_id: str, services: Services, _token: CurrentToken) -> TranslationProviderConfig:
    return services.profiles.get(profile_id)


@router.put(
    "/{profile_id}",
    response_model=TranslationProviderConfig,
    summary="登记或更新服务配置",
    description=(
        "登记用户自定义的兼容端点（如本地 vLLM / 自建网关）。"
        "凭据建议使用 secretRef 引用，避免明文落盘；dataPolicy 由路由与本服务共同执行。"
    ),
)
async def upsert_provider(
    profile_id: str,
    config: TranslationProviderConfig,
    services: Services,
    _token: CurrentToken,
) -> TranslationProviderConfig:
    if config.profile_id != profile_id:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "路径 profileId 与请求体 profileId 不一致",
            {"pathId": profile_id, "bodyId": config.profile_id},
        )
    return services.profiles.upsert(config)


@router.delete("/{profile_id}", summary="删除用户服务配置")
async def delete_provider(profile_id: str, services: Services, _token: CurrentToken) -> dict:
    deleted = services.profiles.delete(profile_id)
    if not deleted:
        raise AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            f"没有可删除的用户配置: {profile_id}（内置种子配置不可删除）",
            {"profileId": profile_id},
        )
    return {"deleted": True, "profileId": profile_id}
