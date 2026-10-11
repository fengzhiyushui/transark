"""统一翻译服务：路由、数据策略、批处理、缓存与对齐校验。

对应接入文档的"专用翻译 JSON"契约（POST /v1/translate）：
- 按 profileId 解析引擎，未指定时使用默认 Profile；
- 数据策略在执行前校验：device-only 不允许指向非本地引擎；
- 超出 limits.maxBatchSize 时自动分批，结果按原始顺序合并；
- 每段成功后写入缓存（键含引擎/模型/语言对/策略版本）；
- 最终用契约对齐规则校验段落 ID（不重复、不遗漏、无未知 ID）。
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from .cache import TranslationCache
from .engines import EngineRegistry
from .engines.base import TranslationEngine
from .models import (
    AppError,
    ErrorCode,
    TranslationProviderConfig,
    TranslationRequest,
    TranslationResponse,
    TranslationSegmentResult,
    assert_translation_alignment,
)
from .netguard import NetworkGuard
from .profiles import ProfileStore

logger = logging.getLogger("local_service.translation")

STRATEGY_VERSION = "translation-strategy-1"

# 数据策略允许的实际处理位置
_POLICY_ALLOWED_LOCATIONS: dict[str, set[str]] = {
    "device-only": {"local"},
    "allow-lan": {"local", "lan", "unverified"},
    "allow-cloud": {"local", "lan", "cloud", "unverified"},
}

SegmentDoneCallback = Callable[[str, str], Awaitable[None] | None]


class TranslationService:
    """翻译编排层（路由层只依赖本类）。"""

    def __init__(
        self,
        *,
        profiles: ProfileStore,
        engines: EngineRegistry,
        guard: NetworkGuard,
        cache: TranslationCache,
        default_profile_id: str,
    ) -> None:
        self._profiles = profiles
        self._engines = engines
        self._guard = guard
        self._cache = cache
        self._default_profile_id = default_profile_id

    # ------------------------------------------------------------------ profile
    def resolve_profile(self, request: TranslationRequest) -> TranslationProviderConfig:
        profile_id = request.profile_id or self._default_profile_id
        profile = self._profiles.get(profile_id)
        if profile.enabled is False:
            raise AppError(
                ErrorCode.RESOURCE_NOT_FOUND,
                f"服务配置已停用: {profile_id}",
                {"profileId": profile_id},
            )
        return profile

    def resolve_engine(self, profile: TranslationProviderConfig) -> TranslationEngine:
        engine = self._engines.resolve(profile)
        self._enforce_policy(profile, engine)
        return engine

    # ------------------------------------------------------------------- policy
    def _enforce_policy(
        self, profile: TranslationProviderConfig, engine: TranslationEngine
    ) -> None:
        allowed = _POLICY_ALLOWED_LOCATIONS.get(profile.data_policy, set())
        location = engine.actual_location
        if location not in allowed:
            raise AppError(
                ErrorCode.POLICY_VIOLATION,
                (
                    f"数据策略 {profile.data_policy!r} 与引擎实际处理位置 {location!r} 冲突"
                    "（禁止未授权的跨模式回退）"
                ),
                {
                    "profileId": profile.profile_id,
                    "dataPolicy": profile.data_policy,
                    "actualLocation": location,
                },
            )
        # device-only 额外要求引擎必须确实在本地运行
        if profile.data_policy == "device-only" and location != "local":
            raise AppError(
                ErrorCode.POLICY_VIOLATION,
                "device-only 策略要求引擎完全本地运行",
                {"profileId": profile.profile_id, "actualLocation": location},
            )

    # ---------------------------------------------------------------- translate
    async def translate(
        self,
        request: TranslationRequest,
        *,
        on_segment_done: SegmentDoneCallback | None = None,
    ) -> TranslationResponse:
        profile = self.resolve_profile(request)
        engine = self.resolve_engine(profile)

        # 重复请求段落 ID 直接拒绝（契约要求 ID 严格唯一）
        seen: set[str] = set()
        duplicates: set[str] = set()
        for seg in request.segments:
            if seg.id in seen:
                duplicates.add(seg.id)
            seen.add(seg.id)
        if duplicates:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                "请求段落 ID 重复: " + ", ".join(sorted(duplicates)),
                {"segmentIds": sorted(duplicates)},
            )

        max_batch = 100
        if profile.limits and profile.limits.max_batch_size:
            max_batch = profile.limits.max_batch_size

        merged: list[TranslationSegmentResult] = []
        duration_ms = 0
        prompt_tokens = 0
        completion_tokens = 0
        any_cache_hit = False

        for start in range(0, len(request.segments), max_batch):
            batch = request.segments[start : start + max_batch]

            # 缓存查询：仅对无错误的成功译文生效
            cached: dict[str, str] = {}
            misses: list[tuple] = []
            for seg in batch:
                key = TranslationCache.build_key(
                    profile_id=profile.profile_id,
                    revision=profile.revision,
                    engine_id=engine.engine_id,
                    engine_revision=engine.engine_revision,
                    request=request,
                    segment_text=seg.text,
                    segment_context=seg.context,
                    strategy_version=STRATEGY_VERSION,
                )
                hit = self._cache.get(key)
                if hit is not None:
                    cached[seg.id] = hit
                    any_cache_hit = True
                else:
                    misses.append((seg, key))

            if misses:
                miss_request = request.model_copy(
                    update={"segments": [seg for seg, _key in misses]},
                    deep=True,
                )
                response = await engine.translate(miss_request)
                assert_translation_alignment(miss_request, response)
                result_by_id = {item.id: item for item in response.segments}
                for seg, key in misses:
                    result = result_by_id.get(seg.id)
                    if result is None:
                        continue
                    merged.append(result)
                    if result.error is None:
                        self._cache.set(key, result.translation)
                        if on_segment_done is not None:
                            await _maybe_await(on_segment_done(seg.id, result.translation))
                if response.metrics:
                    duration_ms += response.metrics.duration_ms or 0
                    prompt_tokens += response.metrics.prompt_tokens or 0
                    completion_tokens += response.metrics.completion_tokens or 0

            for seg in batch:
                if seg.id in cached:
                    merged.append(
                        TranslationSegmentResult(id=seg.id, translation=cached[seg.id])
                    )
                    if on_segment_done is not None:
                        await _maybe_await(on_segment_done(seg.id, cached[seg.id]))

        # 按请求原始顺序对齐输出
        order = {seg.id: idx for idx, seg in enumerate(request.segments)}
        merged.sort(key=lambda item: order.get(item.id, len(order)))

        response = TranslationResponse(
            requestId=request.request_id,
            segments=merged,
            resolvedEngine=engine.resolved_engine(),
            metrics={
                "durationMs": duration_ms,
                "promptTokens": prompt_tokens,
                "completionTokens": completion_tokens,
                "cacheHit": any_cache_hit,
            },
        )
        assert_translation_alignment(request, response)
        return response


async def _maybe_await(value) -> None:
    if value is not None and hasattr(value, "__await__"):
        await value
