"""OpenAI Chat Completions 兼容适配器（用户填写的兼容端点）。

根路径通常已含 ``/v1``，本适配器只拼接 ``/chat/completions``；
反向代理子路径会被保留（见接入文档"API 根路径与具体端点只拼接一次"）。
"""

from __future__ import annotations

import logging

import httpx

from ..models import TranslationRequest, TranslationResponse, TranslationMetrics
from ..netguard import NetworkGuard
from .base import (
    TranslationEngine,
    build_auth_headers,
    join_endpoint,
    map_http_error,
    parse_engine_json,
    translation_prompt,
)

logger = logging.getLogger("local_service.engines.openai_chat")


class OpenAIChatEngine(TranslationEngine):
    """转发到任意 Chat Completions 兼容端点（本地引擎 / 自建网关 / 云端）。"""

    def __init__(self, profile, guard: NetworkGuard, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        super().__init__(profile)
        self._guard = guard
        self._transport = transport

    @property
    def engine_id(self) -> str:
        return f"openai-chat/{self.profile.model}"

    @property
    def actual_location(self) -> str:
        if self.profile.processing_location and self.profile.processing_location != "unverified":
            return self.profile.processing_location
        return self._guard.processing_location(self.profile.base_url)

    def _chat_url(self) -> str:
        base = self.profile.base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        return join_endpoint(base, "chat", "completions")

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
            "temperature": (request.options.temperature if request.options else None) or 0.2,
        }
        if self.profile.capabilities.structured_output:
            payload["response_format"] = {"type": "json_object"}

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
            raise map_http_error(exc, engine_label=f"OpenAI-compatible({url})") from exc

        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices:
            raise AppError(
                ErrorCode.MODEL_UNAVAILABLE,
                "兼容端点未返回 choices",
                {"url": url},
            )
        content = str(choices[0].get("message", {}).get("content", "") or "")
        if not content.strip():
            raise AppError(
                ErrorCode.MODEL_UNAVAILABLE,
                "兼容端点返回了空的生成内容",
                {"url": url, "model": self.profile.model},
            )

        parsed = parse_engine_json(content)
        results = self._segment_results_from_payload(request, parsed)

        usage = data.get("usage") if isinstance(data, dict) else None
        metrics = TranslationMetrics(
            durationMs=_monotonic_ms() - started,
            promptTokens=(usage or {}).get("prompt_tokens"),
            completionTokens=(usage or {}).get("completion_tokens"),
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
