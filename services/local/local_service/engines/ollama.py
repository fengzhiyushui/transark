"""Ollama 原生协议适配器（POST {baseUrl}/api/chat）。

对应接入文档中的"Ollama 原生"适配器：根路径不含 /api 时自动拼接
``/api/chat``；若根路径已以 ``/api`` 结尾则只补 ``/chat``，避免重复。
"""

from __future__ import annotations

import logging

import httpx

from ..models import (
    AppError,
    ErrorCode,
    TranslationRequest,
    TranslationResponse,
    TranslationMetrics,
)
from ..netguard import NetworkGuard
from .base import (
    TranslationEngine,
    build_auth_headers,
    join_endpoint,
    map_http_error,
    parse_engine_json,
    translation_prompt,
)

logger = logging.getLogger("local_service.engines.ollama")


class OllamaEngine(TranslationEngine):
    """转发到本地已部署的 Ollama（http://localhost:11434/api/chat）。"""

    def __init__(self, profile, guard: NetworkGuard, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        super().__init__(profile)
        self._guard = guard
        self._transport = transport

    @property
    def engine_id(self) -> str:
        return f"ollama/{self.profile.model}"

    @property
    def actual_location(self) -> str:
        # 处理位置不能仅从地址推断：显式声明优先，否则按地址归类
        if self.profile.processing_location and self.profile.processing_location != "unverified":
            return self.profile.processing_location
        return self._guard.processing_location(self.profile.base_url)

    def _chat_url(self) -> str:
        base = self.profile.base_url.rstrip("/")
        if base.endswith("/api"):
            return f"{base}/chat"
        return join_endpoint(base, "api", "chat")

    async def translate(self, request: TranslationRequest) -> TranslationResponse:
        system, user = translation_prompt(request)
        headers = build_auth_headers(self.profile)
        headers.update(self.profile.custom_headers or {})

        payload: dict = {
            "model": self.profile.model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "options": {
                "temperature": (request.options.temperature if request.options else None) or 0.2
            },
        }
        if self.profile.capabilities.structured_output:
            payload["format"] = "json"

        url = self._chat_url()
        started = _monotonic_ms()
        client_kwargs: dict = {}
        if self._transport is not None:
            client_kwargs["transport"] = self._transport
        try:
            async with self._guard.client(
                self.profile.data_policy, timeout=self.timeout(), **client_kwargs
            ) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise map_http_error(exc, engine_label=f"Ollama({url})") from exc

        content = ""
        if isinstance(data, dict):
            content = str(data.get("message", {}).get("content", "") or "")
        if not content.strip():
            raise AppError(
                ErrorCode.MODEL_UNAVAILABLE,
                "Ollama 返回了空的生成内容",
                {"url": url, "model": self.profile.model},
            )

        parsed = parse_engine_json(content)
        results = self._segment_results_from_payload(request, parsed)

        prompt_tokens = data.get("prompt_eval_count") if isinstance(data, dict) else None
        completion_tokens = data.get("eval_count") if isinstance(data, dict) else None
        metrics = TranslationMetrics(
            durationMs=_monotonic_ms() - started,
            promptTokens=prompt_tokens,
            completionTokens=completion_tokens,
            cacheHit=False,
        )
        return TranslationResponse(
            requestId=request.request_id,
            segments=results,
            resolvedEngine=self.resolved_engine(),
            metrics=metrics,
        )


def _monotonic_ms() -> int:
    import time

    return int(time.monotonic() * 1000)
