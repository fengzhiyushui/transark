"""引擎注册表：按协议把 Profile 解析为具体引擎。

支持协议：
- ``custom-translate``：内置混合引擎（完全本地，无网络）；
- ``ollama``：Ollama 原生 /api/chat；
- ``openai-chat``：Chat Completions 兼容端点（本地引擎 / 自建网关 / 云端）。

其他协议一律返回 UNSUPPORTED_PROTOCOL——不伪装兼容。
"""

from __future__ import annotations

import httpx

from ..models import AppError, ErrorCode, TranslationProviderConfig
from ..netguard import NetworkGuard
from .base import TranslationEngine
from .echo import BuiltinEngine
from .ollama import OllamaEngine
from .openai_chat import OpenAIChatEngine

SUPPORTED_PROTOCOLS = ("custom-translate", "ollama", "openai-chat")


class EngineRegistry:
    """Profile → TranslationEngine 解析器。"""

    def __init__(self, guard: NetworkGuard, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._guard = guard
        self._transport = transport

    def supports(self, protocol: str) -> bool:
        return protocol in SUPPORTED_PROTOCOLS

    def resolve(self, profile: TranslationProviderConfig) -> TranslationEngine:
        protocol = profile.protocol
        if protocol == "custom-translate":
            return BuiltinEngine(profile)
        if protocol == "ollama":
            return OllamaEngine(profile, self._guard, transport=self._transport)
        if protocol == "openai-chat":
            return OpenAIChatEngine(profile, self._guard, transport=self._transport)
        raise AppError(
            ErrorCode.UNSUPPORTED_PROTOCOL,
            f"本服务暂不支持协议适配器: {protocol!r}",
            {
                "profileId": profile.profile_id,
                "protocol": protocol,
                "supported": list(SUPPORTED_PROTOCOLS),
            },
        )
