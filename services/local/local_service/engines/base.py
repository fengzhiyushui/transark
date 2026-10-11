"""翻译引擎抽象与公共工具。"""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from typing import Any

import httpx

from ..models import (
    AppError,
    DataPolicy,
    ErrorCode,
    ResolvedEngineInfo,
    TranslationProviderConfig,
    TranslationRequest,
    TranslationResponse,
    TranslationSegmentResult,
)
from ..models.config import ProcessingLocation


class TranslationEngine(ABC):
    """翻译引擎统一接口。

    实现方负责把 :class:`TranslationRequest` 转换为目标引擎的请求，
    并把结果对齐回 :class:`TranslationResponse`。引擎不得静默切换上游；
    失败时必须抛出带错误码的 :class:`AppError`。
    """

    def __init__(self, profile: TranslationProviderConfig) -> None:
        self.profile = profile

    # -------------------------------------------------------------- meta
    @property
    @abstractmethod
    def engine_id(self) -> str:
        """引擎标识，如 'ollama/qwen2.5:7b'、'built-in/hybrid'。"""

    @property
    def engine_revision(self) -> str:
        """引擎/路由配置版本标识（配置变化时改变，用于缓存隔离）。"""
        canonical = json.dumps(
            {
                "protocol": self.profile.protocol,
                "baseUrl": self.profile.base_url,
                "model": self.profile.model,
                "revision": self.profile.revision,
            },
            sort_keys=True,
        )
        return hashlib.sha1(canonical.encode("utf-8")).hexdigest()[:12]

    @property
    def actual_location(self) -> ProcessingLocation:
        """引擎声明的实际处理位置；无法从地址推断时返回 'unverified'。"""
        return self.profile.processing_location or "unverified"

    def resolved_engine(self) -> ResolvedEngineInfo:
        return ResolvedEngineInfo(
            id=self.engine_id,
            revision=self.engine_revision,
            actualLocation=self.actual_location,
        )

    # -------------------------------------------------------------- translate
    @abstractmethod
    async def translate(self, request: TranslationRequest) -> TranslationResponse:
        """执行翻译并返回严格对齐的响应。"""

    # -------------------------------------------------------------- helpers
    def timeout(self) -> float:
        limits = self.profile.limits
        if limits and limits.timeout_ms:
            return limits.timeout_ms / 1000.0
        return 30.0

    def _segment_results_from_payload(
        self, request: TranslationRequest, payload: Any
    ) -> list[TranslationSegmentResult]:
        """把引擎返回的 JSON 载荷转换为段落结果列表。

        容忍三种常见形态：
        - ``[{"id": ..., "translation": ...}, ...]``
        - ``{"segments": [...]}`` / ``{"translations": [...]}``
        - 单个 ``{"id": ..., "translation": ...}``（退化一段一请求）
        """
        items: list[Any]
        if isinstance(payload, list):
            items = payload
        elif isinstance(payload, dict):
            for key in ("segments", "translations", "results", "data"):
                value = payload.get(key)
                if isinstance(value, list):
                    items = value
                    break
            else:
                items = [payload]
        else:
            raise AppError(
                ErrorCode.ALIGNMENT_MISMATCH,
                f"引擎返回了无法解析的翻译结果: {type(payload).__name__}",
            )

        by_id: dict[str, str] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            seg_id = item.get("id") or item.get("segmentId")
            translation = item.get("translation")
            if translation is None:
                translation = item.get("text")
            if seg_id is None or translation is None:
                continue
            by_id[str(seg_id)] = str(translation)

        results: list[TranslationSegmentResult] = []
        for seg in request.segments:
            translation = by_id.get(seg.id)
            if translation is None:
                results.append(
                    TranslationSegmentResult(
                        id=seg.id,
                        translation="",
                        error={
                            "code": ErrorCode.ALIGNMENT_MISMATCH,
                            "message": f"Engine did not return a translation for segment: {seg.id}",
                        },
                    )
                )
            else:
                results.append(TranslationSegmentResult(id=seg.id, translation=translation))
        return results


def parse_engine_json(content: str) -> Any:
    """从模型输出中提取 JSON（容忍 ```json 代码围栏与前后缀杂文本）。"""
    text = content.strip()
    if text.startswith("```"):
        # 去掉首尾代码围栏
        lines = text.splitlines()
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 尝试截取第一个 [ 或 { 到最后一个 ] 或 }
    start_candidates = [i for i in (text.find("["), text.find("{")) if i != -1]
    if not start_candidates:
        raise AppError(ErrorCode.ALIGNMENT_MISMATCH, "引擎输出不是有效的 JSON")
    start = min(start_candidates)
    end_candidates = [i for i in (text.rfind("]"), text.rfind("}")) if i != -1]
    if not end_candidates:
        raise AppError(ErrorCode.ALIGNMENT_MISMATCH, "引擎输出不是有效的 JSON")
    end = max(end_candidates)
    snippet = text[start : end + 1]
    try:
        return json.loads(snippet)
    except json.JSONDecodeError as exc:
        raise AppError(
            ErrorCode.ALIGNMENT_MISMATCH,
            f"引擎输出 JSON 解析失败: {exc}",
            {"raw": content[:500]},
        ) from exc


def map_http_error(exc: httpx.HTTPError, *, engine_label: str) -> AppError:
    """把 httpx 异常映射为带契约错误码的 AppError。"""
    if isinstance(exc, httpx.ConnectTimeout | httpx.ReadTimeout | httpx.WriteTimeout | httpx.PoolTimeout):
        return AppError(
            ErrorCode.TIMEOUT,
            f"{engine_label} 请求超时",
            {"engine": engine_label},
        )
    if isinstance(exc, httpx.ConnectError):
        return AppError(
            ErrorCode.NETWORK_ERROR,
            f"无法连接 {engine_label}（服务未启动或地址不可达）",
            {"engine": engine_label},
        )
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        detail = _safe_error_body(exc.response)
        if status in (401, 403):
            code = ErrorCode.AUTH_FAILED
        elif status == 404:
            code = ErrorCode.MODEL_UNAVAILABLE
        elif status == 429:
            code = ErrorCode.RATE_LIMITED
        elif 400 <= status < 500:
            code = ErrorCode.INVALID_REQUEST
        else:
            code = ErrorCode.NETWORK_ERROR
        return AppError(
            code,
            f"{engine_label} 返回 HTTP {status}",
            {"engine": engine_label, "status": status, "body": detail},
        )
    return AppError(
        ErrorCode.NETWORK_ERROR,
        f"{engine_label} 网络异常: {exc}",
        {"engine": engine_label},
    )


def _safe_error_body(response: httpx.Response) -> str:
    try:
        return response.text[:500]
    except Exception:  # noqa: BLE001  # pragma: no cover
        return "<unreadable>"


def build_auth_headers(profile: TranslationProviderConfig) -> dict[str, str]:
    """根据鉴权配置构造请求头。secretRef 优先从环境变量解析。"""
    import os

    auth = profile.auth
    headers: dict[str, str] = {}
    if auth.type == "none":
        return headers
    if auth.type == "bearer":
        token = auth.token
        if not token and auth.secret_ref:
            token = os.environ.get(f"TRANSLATE_SECRET_{auth.secret_ref.upper().replace('-', '_')}")
        if not token:
            raise AppError(
                ErrorCode.AUTH_FAILED,
                "Bearer 鉴权缺少令牌（token 或可解析的 secretRef）",
                {"profileId": profile.profile_id, "secretRef": auth.secret_ref},
            )
        headers["Authorization"] = f"Bearer {token}"
        return headers
    if auth.type == "api-key":
        key = auth.api_key
        if not key and auth.secret_ref:
            key = os.environ.get(f"TRANSLATE_SECRET_{auth.secret_ref.upper().replace('-', '_')}")
        if not key:
            raise AppError(
                ErrorCode.AUTH_FAILED,
                "API Key 鉴权缺少密钥（apiKey 或可解析的 secretRef）",
                {"profileId": profile.profile_id, "secretRef": auth.secret_ref},
            )
        headers[auth.header_name or "x-api-key"] = key
        return headers
    if auth.type == "custom":
        value = auth.token or auth.api_key
        if not value:
            raise AppError(
                ErrorCode.AUTH_FAILED,
                "自定义鉴权缺少凭据",
                {"profileId": profile.profile_id},
            )
        if not auth.header_name:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                "自定义鉴权必须提供 headerName",
                {"profileId": profile.profile_id},
            )
        headers[auth.header_name] = value
        return headers
    raise AppError(
        ErrorCode.UNSUPPORTED_PROTOCOL,
        f"不支持的鉴权类型: {auth.type}",
        {"profileId": profile.profile_id, "authType": auth.type},
    )


def join_endpoint(base_url: str, *parts: str) -> str:
    """拼接端点：避免重复补 /v1 或丢失网关前缀（见接入文档约定）。"""
    base = base_url.rstrip("/")
    tail = "/".join(p.strip("/") for p in parts if p)
    return f"{base}/{tail}" if tail else base


def translation_prompt(request: TranslationRequest) -> tuple[str, str]:
    """构造翻译用的 system / user 提示词（要求严格 JSON 输出）。"""
    options = request.options
    preserve = bool(options.preserve_terminology) if options else False
    temperature = options.temperature if options and options.temperature is not None else 0.2
    fmt = options.format if options else "text"

    system = (
        "You are a professional translation engine embedded in a local companion service. "
        f"Translate every segment from '{request.source_language}' to '{request.target_language}'. "
        "Rules: preserve placeholders, IDs, numbers, code and markup; do not add explanations; "
        "do not merge or split segments; return ONLY a JSON array of objects "
        'shaped like [{"id": "<segment id>", "translation": "<translated text>"}] '
        "with exactly one entry per input segment, in the same order. "
        f"Text format convention: {fmt}. "
        + (
            "Keep proper nouns and terminology consistent with the provided context."
            if preserve
            else "Translate naturally."
        )
        + f" Use a low, deterministic temperature ({temperature})."
    )

    segments_payload = [
        {"id": seg.id, "text": seg.text, **({"context": seg.context} if seg.context else {})}
        for seg in request.segments
    ]
    user = (
        "Translate the following segments. Respond with the JSON array only.\n"
        + json.dumps({"segments": segments_payload}, ensure_ascii=False)
    )
    return system, user


def data_policy_of(profile: TranslationProviderConfig) -> DataPolicy:
    return profile.data_policy
