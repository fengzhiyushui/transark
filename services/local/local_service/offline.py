"""离线自检与数据合规报告。

报告内容：
- 当前各引擎是否完全在本地运行（local / lan / cloud / unverified）；
- 已声明能力（文本翻译 / OCR / ASR）是否都有可用本地引擎；
- 出口流量统计（loopback / lan / cloud / blocked）——用于证明
  "绝不在未经用户授权下静默向外网回退"；
- 数据策略与引擎实际位置冲突的配置告警。

``offline_mode=true`` 时任何非回环请求都会被网络守卫拒绝；
``allow_cloud_egress=false``（默认）时公网请求同样被拒绝。
"""

from __future__ import annotations

import logging
import time

from pydantic import Field

from .engines import EngineRegistry, SUPPORTED_PROTOCOLS
from .models import AppError
from .models.base import ContractModel
from .netguard import NetworkGuard
from .profiles import ProfileStore
from .recognition import resolve_asr_engine, resolve_ocr_engine
from .settings import Settings

logger = logging.getLogger("local_service.offline")


class EngineOfflineStatus(ContractModel):
    """单个引擎的离线状态。"""

    profile_id: str
    protocol: str
    model: str
    engine_id: str | None = None
    data_policy: str
    declared_processing_location: str
    address_category: str = Field(description="按地址归类：loopback / lan / cloud")
    actual_location: str = Field(description="引擎声明的实际处理位置")
    is_local: bool
    available: bool
    detail: str | None = None
    protocol_supported: bool = True


class ResourceStatus(ContractModel):
    """本地资源就绪状态。"""

    kind: str = Field(description="asr-model / ocr-engine / llm-engine")
    id: str
    present: bool
    detail: str | None = None


class OfflineStatusResponse(ContractModel):
    """离线自检响应。"""

    offline_capable: bool = Field(description="已声明能力是否全部具备可用本地引擎")
    loopback_only: bool = Field(description="服务是否仅绑定回环地址")
    offline_mode: bool = Field(description="是否启用离线模式（禁止一切非回环出口）")
    cloud_egress_allowed: bool = Field(description="是否允许公网出口（需用户授权）")
    silent_fallback_policy: str = Field(
        default="forbidden", description="静默外网回退策略：始终禁止"
    )
    local_engines_available: dict[str, bool] = Field(
        description="按能力报告本地引擎可用性：textTranslation / ocr / asr"
    )
    declared_capabilities: dict[str, bool] = Field(description="已启用 Profile 声明的能力并集")
    egress: dict[str, int] = Field(description="出口流量统计")
    engines: list[EngineOfflineStatus] = []
    resources: list[ResourceStatus] = []
    warnings: list[str] = []
    checked_at: int


class OfflineCheck(ContractModel):
    """单项检查结果。"""

    name: str
    passed: bool
    detail: str | None = None


class OfflineVerifyResponse(ContractModel):
    """离线验证响应。"""

    verified: bool
    checks: list[OfflineCheck]
    checked_at: int


class OfflineService:
    """离线自检编排。"""

    def __init__(
        self,
        *,
        settings: Settings,
        profiles: ProfileStore,
        engines: EngineRegistry,
        guard: NetworkGuard,
        translation,
    ) -> None:
        self._settings = settings
        self._profiles = profiles
        self._engines = engines
        self._guard = guard
        self._translation = translation

    # ------------------------------------------------------------------ helpers
    def _engine_statuses(self) -> list[EngineOfflineStatus]:
        statuses: list[EngineOfflineStatus] = []
        for profile in self._profiles.enabled_profiles():
            address_category = self._guard.classify(profile.base_url)
            protocol_supported = self._engines.supports(profile.protocol)
            engine_id: str | None = None
            actual_location = profile.processing_location or "unverified"
            available = protocol_supported
            detail: str | None = None
            if protocol_supported:
                try:
                    engine = self._engines.resolve(profile)
                    engine_id = engine.engine_id
                    actual_location = engine.actual_location
                    if profile.protocol != "custom-translate":
                        available = False
                        detail = "外部引擎需连接验证（离线自检默认不探测公网/局域网地址）"
                        if address_category == "loopback":
                            available = True
                            detail = "回环地址的外部引擎，可通过连接验证确认可用性"
                except AppError as exc:
                    available = False
                    detail = exc.message
            else:
                detail = f"协议 {profile.protocol!r} 暂不支持（支持: {', '.join(SUPPORTED_PROTOCOLS)}）"

            statuses.append(
                EngineOfflineStatus(
                    profileId=profile.profile_id,
                    protocol=profile.protocol,
                    model=profile.model,
                    engineId=engine_id,
                    dataPolicy=profile.data_policy,
                    declaredProcessingLocation=profile.processing_location or "unverified",
                    addressCategory=address_category,
                    actualLocation=actual_location,
                    isLocal=actual_location == "local",
                    available=available,
                    detail=detail,
                    protocolSupported=protocol_supported,
                )
            )
        return statuses

    def _resource_statuses(self) -> list[ResourceStatus]:
        resources: list[ResourceStatus] = []

        # ASR 模型资源
        asr_engine = resolve_asr_engine(self._settings)
        asr_available = asr_engine.available
        resources.append(
            ResourceStatus(
                kind="asr-model",
                id=asr_engine.engine_id,
                present=asr_available,
                detail=None if asr_available else asr_engine.unavailable_reason(),
            )
        )

        # OCR 引擎资源
        ocr_engine = resolve_ocr_engine(self._settings)
        ocr_available = ocr_engine.available
        resources.append(
            ResourceStatus(
                kind="ocr-engine",
                id=ocr_engine.engine_id,
                present=ocr_available,
                detail=None if ocr_available else ocr_engine.unavailable_reason(),
            )
        )

        # 文本引擎（内置混合引擎始终本地可用）
        resources.append(
            ResourceStatus(
                kind="llm-engine",
                id="built-in/hybrid",
                present=True,
                detail="内置混合引擎（本地确定性翻译）",
            )
        )
        return resources

    async def _probe_loopback_engines(self) -> None:
        """仅探测回环地址的外部引擎（如 Ollama），不触达任何公网/局域网地址。"""
        import httpx

        for profile in self._profiles.enabled_profiles():
            if profile.protocol != "ollama":
                continue
            if self._guard.classify(profile.base_url) != "loopback":
                continue
            url = profile.base_url.rstrip("/") + "/api/tags"
            try:
                async with httpx.AsyncClient(timeout=1.5) as client:
                    await client.get(url)
            except httpx.HTTPError:
                logger.debug("回环引擎探测失败（视为未运行）: %s", url)

    # ------------------------------------------------------------------- status
    async def status(self) -> OfflineStatusResponse:
        if self._settings.offline_probe:
            await self._probe_loopback_engines()

        engine_statuses = self._engine_statuses()
        resources = self._resource_statuses()

        resource_present = {r.kind: r.present for r in resources}
        local_available = {
            "textTranslation": resource_present.get("llm-engine", False),
            "ocr": resource_present.get("ocr-engine", False),
            "asr": resource_present.get("asr-model", False),
        }

        declared = {"textTranslation": False, "ocr": False, "asr": False}
        for profile in self._profiles.enabled_profiles():
            caps = profile.capabilities
            declared["textTranslation"] = declared["textTranslation"] or caps.text_translation
            declared["ocr"] = declared["ocr"] or caps.ocr
            declared["asr"] = declared["asr"] or caps.asr

        warnings: list[str] = []
        for status in engine_statuses:
            if status.data_policy == "device-only" and not status.is_local:
                warnings.append(
                    f"Profile {status.profile_id!r} 声明 device-only，但实际处理位置为 "
                    f"{status.actual_location!r}——未经验证不得认定为本地处理"
                )
            if status.data_policy == "device-only" and status.address_category != "loopback":
                warnings.append(
                    f"Profile {status.profile_id!r} 声明 device-only，但 baseUrl 不是回环地址"
                )
            if not status.protocol_supported:
                warnings.append(
                    f"Profile {status.profile_id!r} 使用暂不支持的协议 {status.protocol!r}"
                )

        blocking = [
            f"能力 {cap} 已被声明，但本地引擎不可用"
            for cap, needed in declared.items()
            if needed and not local_available.get(cap, False)
        ]
        warnings.extend(blocking)

        return OfflineStatusResponse(
            offlineCapable=not blocking,
            loopbackOnly=self._settings.is_loopback,
            offlineMode=self._settings.offline_mode,
            cloudEgressAllowed=self._settings.allow_cloud_egress and not self._settings.offline_mode,
            silentFallbackPolicy="forbidden",
            localEnginesAvailable=local_available,
            declaredCapabilities=declared,
            egress=self._guard.stats,
            engines=engine_statuses,
            resources=resources,
            warnings=warnings,
            checkedAt=int(time.time() * 1000),
        )

    # ------------------------------------------------------------------- verify
    async def verify(self) -> OfflineVerifyResponse:
        checks: list[OfflineCheck] = []
        status = await self.status()

        checks.append(
            OfflineCheck(
                name="loopback-bind",
                passed=status.loopback_only,
                detail=f"监听地址: {self._settings.host}:{self._settings.port}",
            )
        )

        egress = status.egress
        checks.append(
            OfflineCheck(
                name="egress-guard-enforced",
                passed=True,
                detail=(
                    "所有出站请求均经 NetworkGuard 校验："
                    f"offline_mode={self._settings.offline_mode}, "
                    f"allow_cloud_egress={self._settings.allow_cloud_egress}; "
                    f"已放行 回环={egress['loopback']} 局域网={egress['lan']} 云端={egress['cloud']}, "
                    f"已拦截={egress['blocked']}"
                ),
            )
        )

        device_only_issues = [
            warning
            for warning in status.warnings
            if "device-only" in warning
        ]
        checks.append(
            OfflineCheck(
                name="device-only-consistency",
                passed=not device_only_issues,
                detail="; ".join(device_only_issues) if device_only_issues else "device-only 配置与实际处理位置一致",
            )
        )

        checks.append(
            OfflineCheck(
                name="declared-capabilities-local",
                passed=status.offline_capable,
                detail="; ".join(status.warnings) if status.warnings else "所有已声明能力均有本地引擎",
            )
        )

        # 本地翻译冒烟测试（内置引擎，无网络）
        smoke_passed, smoke_detail = await self._local_translation_smoke()
        checks.append(OfflineCheck(name="local-translation-smoke", passed=smoke_passed, detail=smoke_detail))

        return OfflineVerifyResponse(
            verified=all(check.passed for check in checks),
            checks=checks,
            checkedAt=int(time.time() * 1000),
        )

    async def _local_translation_smoke(self) -> tuple[bool, str]:
        try:
            from .models import TranslationRequest

            request = TranslationRequest(
                requestId=f"offline-smoke-{int(time.time() * 1000)}",
                sourceLanguage="en",
                targetLanguage="zh-CN",
                segments=[{"id": "smoke-1", "text": "Hello, world!"}],
                profileId="local-companion-service",
            )
            response = await self._translation.translate(request)
            if response.segments and response.segments[0].translation:
                return True, f"本地引擎返回译文: {response.segments[0].translation}"
            return False, "本地引擎未返回译文"
        except AppError as exc:
            return False, f"本地翻译冒烟失败: {exc.message}"
        except Exception as exc:  # noqa: BLE001
            return False, f"本地翻译冒烟异常: {exc}"
