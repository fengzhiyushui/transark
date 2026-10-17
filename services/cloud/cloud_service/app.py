"""云端服务应用工厂。

方案 A 的核心取舍：**不重写翻译/ASR 内核**——契约模型、四种协议引擎、
文档/字幕解析、长任务管理器全部复用 ``local_service``，本服务只负责
云端化的外壳差异：

- 鉴权：配对码 → 预共享 API Key + 限流（``auth.py``）；
- 数据策略：云端出口默认授权（``allow_cloud_egress=True``），
  NetworkGuard 仍拦截回环地址 SSRF；
- 缓存：进程内 LRU → 可选 Redis（``cache_backend.py``）；
- 新增端点：``/v1/subtitles/*``（提取 + SSE 流式翻译）、``/v1/asr/stream``（WS）。
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from local_service.api import (
    documents_router,
    health_router,
    jobs_router,
    translate_router,
)
from local_service.api.deps import require_token
from local_service.documents import DocumentService
from local_service.engines import EngineRegistry
from local_service.jobs import JobManager, build_handlers
from local_service.models import (
    AppError,
    ErrorCode,
    ErrorEnvelope,
    TranslationProviderConfig,
)
from local_service.netguard import NetworkGuard
from local_service.offline import OfflineService
from local_service.profiles import ProfileStore
from local_service.recognition import resolve_asr_engine
from local_service.security import PairingService
from local_service.settings import Settings as LocalSettings
from local_service.state import AppServices
from local_service.translation_service import TranslationService

from .api import asr_router, subtitles_router
from .auth import RateLimiter, make_require_api_key, require_cloud_client
from .cache_backend import build_cache
from .settings import CloudSettings

logger = logging.getLogger("cloud_service")

DESCRIPTION = """
TransArk 云端服务（方案 A）——面向浏览器扩展的字幕翻译与实时 ASR 服务。

* `POST /v1/subtitles/translate`：字幕/段落翻译（契约与本地服务一致，`?stream=true` 走 SSE 逐 cue 下发）
* `POST /v1/subtitles/extract`：SRT/VTT 字幕提取（Base64 / 文本 / URL）
* `WS   /v1/asr/stream`：无字幕视频的实时语音识别（PCM 流 → cue 流 → 可选内联翻译）
* `POST /v1/jobs`：长音频整段转写等长任务（复用本地服务任务契约）
"""


def build_local_settings(settings: CloudSettings) -> LocalSettings:
    """把云端配置映射为 local_service 内核使用的运行时配置。"""
    return LocalSettings(
        host=settings.host,
        port=settings.port,
        allow_non_loopback_bind=True,
        data_dir=settings.data_dir,
        default_profile_id=settings.default_profile_id,
        allow_cloud_egress=True,  # 云端服务的职责就是调用第三方 API
        offline_mode=False,
        translation_cache_ttl_seconds=settings.cache_ttl_seconds,
        translation_cache_max_entries=settings.cache_max_entries,
        max_concurrent_jobs=settings.max_concurrent_jobs,
        ocr_engine="mock",
        asr_engine=settings.asr_engine,
        asr_model_id=settings.asr_model_id,
        whisper_binary=settings.whisper_binary,
        asr_model_path=settings.asr_model_path,
        offline_probe=False,
        log_level=settings.log_level,
    )


def seed_profiles(profiles: ProfileStore, settings: CloudSettings) -> None:
    """把云端 Provider 配置写入 ProfileStore（密钥仅存服务端）。"""
    if settings.providers_json:
        import json

        raw = json.loads(settings.providers_json)
        if not isinstance(raw, list):
            raise ValueError("CLOUD_PROVIDERS_JSON 必须是 JSON 数组")
        for item in raw:
            profiles.upsert(TranslationProviderConfig.model_validate(item))
        return

    profiles.upsert(
        TranslationProviderConfig(
            profileId=settings.default_profile_id,
            revision=1,
            name=settings.provider_name,
            protocol=settings.provider_protocol,
            baseUrl=settings.provider_base_url,
            model=settings.provider_model,
            auth={"type": "bearer", "apiKey": settings.provider_api_key},
            dataPolicy="allow-cloud",
            deploymentLocation="cloud",
            processingLocation="cloud",
            capabilities={
                "textTranslation": True,
                "ocr": False,
                "asr": False,
                "streaming": True,
                "structuredOutput": True,
            },
            limits={"maxBatchSize": 50, "timeoutMs": 30000, "concurrency": 4},
            isDefault=True,
            enabled=True,
        )
    )


def build_services(settings: CloudSettings) -> AppServices:
    """构造服务容器（复用 local_service 内核，替换缓存后端与默认 Profile）。"""
    local_settings = build_local_settings(settings)
    local_settings.ensure_data_dir()

    guard = NetworkGuard(local_settings)
    # 云端 Provider Key 只来自环境变量/启动配置，不落盘
    profiles = ProfileStore(local_settings.data_dir, persist=False)
    engines = EngineRegistry(guard)
    cache = build_cache(settings)
    translation = TranslationService(
        profiles=profiles,
        engines=engines,
        guard=guard,
        cache=cache,
        default_profile_id=settings.default_profile_id,
    )
    documents = DocumentService()
    pairing = PairingService(pairing_code=None, data_dir=local_settings.data_dir)
    handlers = build_handlers(
        settings=local_settings, documents=documents, translation=translation
    )
    # 云端不提供 OCR（当前只有 mock 引擎，避免返回伪造识别结果）
    handlers.pop("document-ocr", None)
    jobs = JobManager(
        handlers,
        max_concurrent_jobs=settings.max_concurrent_jobs,
    )
    offline = OfflineService(
        settings=local_settings,
        profiles=profiles,
        engines=engines,
        guard=guard,
        translation=translation,
    )
    services = AppServices(
        settings=local_settings,
        pairing=pairing,
        guard=guard,
        profiles=profiles,
        engines=engines,
        cache=cache,
        translation=translation,
        documents=documents,
        jobs=jobs,
        offline=offline,
    )
    seed_profiles(profiles, settings)

    # ASR 引擎：云服务显式选择（默认 faster-whisper），不可用即报错，绝不静默降级
    services.asr_engine = resolve_asr_engine(local_settings)  # type: ignore[attr-defined]
    return services


def create_app(settings: CloudSettings | None = None) -> FastAPI:
    settings = settings or CloudSettings()
    limiter = RateLimiter(settings.rate_limit_rpm, settings.redis_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        services = build_services(settings)
        app.state.services = services
        app.state.cloud_settings = settings
        app.state.rate_limiter = limiter
        logger.info(
            "云端服务已启动: %s:%s (keys=%d, asr=%s, redis=%s)",
            settings.host,
            settings.port,
            len(settings.parsed_api_keys()),
            settings.asr_engine,
            bool(settings.redis_url),
        )
        try:
            yield
        finally:
            await services.jobs.shutdown()
            logger.info("云端服务已停止")

    app = FastAPI(
        title="TransArk Cloud Service",
        description=DESCRIPTION,
        version=_version(),
        lifespan=lifespan,
    )

    # 鉴权覆盖：云端 API Key 取代本地配对令牌（含复用的本地路由）
    require_api_key = make_require_api_key(settings, limiter)
    app.dependency_overrides[require_token] = require_api_key
    app.dependency_overrides[require_cloud_client] = require_api_key

    app.include_router(health_router)
    app.include_router(translate_router)
    app.include_router(documents_router)
    app.include_router(jobs_router)
    app.include_router(subtitles_router)
    app.include_router(asr_router)

    _register_exception_handlers(app)
    return app


def _version() -> str:
    from . import __version__

    return __version__


def _register_exception_handlers(app: FastAPI) -> None:
    """统一错误信封（与 local_service 语义一致）。"""

    @app.exception_handler(AppError)
    async def _app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        envelope = ErrorEnvelope(error=exc.to_dict())
        return JSONResponse(status_code=exc.http_status, content=envelope.model_dump(mode="json"))

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        error = AppError(
            ErrorCode.INVALID_REQUEST,
            "请求参数校验失败",
            {"errors": [str(err.get("msg", "")) for err in exc.errors()]},
        )
        envelope = ErrorEnvelope(error=error.to_dict())
        return JSONResponse(status_code=error.http_status, content=envelope.model_dump(mode="json"))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {
            400: ErrorCode.INVALID_REQUEST,
            401: ErrorCode.AUTH_FAILED,
            404: ErrorCode.RESOURCE_NOT_FOUND,
            429: ErrorCode.RATE_LIMITED,
        }.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
        envelope = ErrorEnvelope(error=AppError(code, str(exc.detail)).to_dict())
        return JSONResponse(status_code=exc.status_code, content=envelope.model_dump(mode="json"))

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("未处理异常: %s", exc)
        envelope = ErrorEnvelope(
            error=AppError(ErrorCode.INTERNAL_ERROR, "服务内部错误").to_dict()
        )
        return JSONResponse(status_code=500, content=envelope.model_dump(mode="json"))
