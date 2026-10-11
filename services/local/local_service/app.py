"""FastAPI 应用工厂与全局异常处理。"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import (
    documents_router,
    health_router,
    jobs_router,
    offline_router,
    pair_router,
    providers_router,
    translate_router,
)
from .models import AppError, ErrorCode, ErrorEnvelope
from .settings import Settings
from .state import AppServices, build_services

logger = logging.getLogger("local_service")

DESCRIPTION = """
本地伴随服务（Local Companion Service）——仅监听回环地址的翻译处理服务。

* 统一翻译接口 `POST /v1/translate`（与 `packages/contracts` 严格对齐）
* 文档解析/导出：TXT、Markdown、DOCX、PDF（含坐标）、SRT/VTT
* OCR / ASR 长任务（Job ID 状态查询与取消，SSE 进度事件）
* 离线自检：本地引擎可用性与出口流量报告，禁止未授权的静默外网回退
"""


def create_app(settings: Settings | None = None) -> FastAPI:
    """创建 FastAPI 应用（测试可通过注入 Settings 隔离数据目录）。"""
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        services: AppServices = build_services(settings)
        app.state.services = services
        app.state.settings = settings
        logger.info(
            "本地伴随服务已启动: %s:%s (loopback=%s, data_dir=%s)",
            settings.host,
            settings.port,
            settings.is_loopback,
            settings.data_dir,
        )
        try:
            yield
        finally:
            await services.jobs.shutdown()
            logger.info("本地伴随服务已停止")

    app = FastAPI(
        title="Local Companion Service",
        description=DESCRIPTION,
        version=_version(),
        lifespan=lifespan,
    )

    app.include_router(health_router)
    app.include_router(pair_router)
    app.include_router(translate_router)
    app.include_router(documents_router)
    app.include_router(jobs_router)
    app.include_router(offline_router)
    app.include_router(providers_router)

    _extend_openapi_with_contract_models(app)
    _register_exception_handlers(app)
    return app


# 经长任务承载、未直接作为响应模型的契约（补充到 OpenAPI components 便于对齐校验）
_CONTRACT_MODELS_FOR_OPENAPI = (
    "OcrRequest",
    "OcrResponse",
    "OcrBlock",
    "AsrRequest",
    "AsrResponse",
    "AsrCue",
    "FileTranslationJobInput",
    "FileTranslationJobResult",
)


def _extend_openapi_with_contract_models(app: FastAPI) -> None:
    from fastapi.openapi.utils import get_openapi

    from . import models as _models
    from .jobs import handlers as _handlers

    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        for name in _CONTRACT_MODELS_FOR_OPENAPI:
            model = getattr(_models, name, None) or getattr(_handlers, name, None)
            if model is None:
                continue
            model_schema = model.model_json_schema(
                ref_template="#/components/schemas/{model}"
            )
            for def_name, sub_schema in (model_schema.get("$defs") or {}).items():
                components.setdefault(def_name, sub_schema)
            components[name] = {
                key: value for key, value in model_schema.items() if key != "$defs"
            }
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi


def _version() -> str:
    from . import __version__

    return __version__


def _register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        envelope = ErrorEnvelope(error=exc.to_dict())
        return JSONResponse(status_code=exc.http_status, content=envelope.model_dump(mode="json"))

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        error = AppError(
            ErrorCode.INVALID_REQUEST,
            "请求参数校验失败",
            {"errors": _serializable_errors(exc)},
        )
        envelope = ErrorEnvelope(error=error.to_dict())
        return JSONResponse(status_code=error.http_status, content=envelope.model_dump(mode="json"))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_TO_CODE.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
        error = AppError(code, str(exc.detail), {"status": exc.status_code})
        envelope = ErrorEnvelope(error=error.to_dict())
        return JSONResponse(status_code=exc.status_code, content=envelope.model_dump(mode="json"))

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("未处理异常: %s", exc)
        error = AppError(ErrorCode.INTERNAL_ERROR, "服务内部错误")
        envelope = ErrorEnvelope(error=error.to_dict())
        return JSONResponse(status_code=500, content=envelope.model_dump(mode="json"))


_STATUS_TO_CODE: dict[int, ErrorCode] = {
    400: ErrorCode.INVALID_REQUEST,
    401: ErrorCode.AUTH_FAILED,
    403: ErrorCode.POLICY_VIOLATION,
    404: ErrorCode.RESOURCE_NOT_FOUND,
    405: ErrorCode.INVALID_REQUEST,
    409: ErrorCode.CANCELLED,
    422: ErrorCode.INVALID_REQUEST,
    429: ErrorCode.RATE_LIMITED,
    502: ErrorCode.NETWORK_ERROR,
    503: ErrorCode.MODEL_UNAVAILABLE,
    504: ErrorCode.TIMEOUT,
}


def _serializable_errors(exc: RequestValidationError) -> list[dict]:
    errors: list[dict] = []
    for error in exc.errors():
        errors.append(
            {
                "loc": [str(part) for part in error.get("loc", [])],
                "message": error.get("msg", ""),
                "type": error.get("type", ""),
            }
        )
    return errors
