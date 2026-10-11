"""进程内翻译缓存（按契约的缓存隔离维度设计）。

缓存键包含：profileId、revision、引擎 ID、引擎版本、语言对、原文、
上下文与翻译策略版本——与接入文档"缓存按服务配置、协议、模型、实际引擎/
路由版本、语言、原文和翻译策略隔离"一致。
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import OrderedDict

from .models import TranslationOptions, TranslationRequest


class TranslationCache:
    """带 TTL 与容量上限的 LRU 缓存（仅缓存校验成功的段落译文）。"""

    def __init__(self, ttl_seconds: int = 900, max_entries: int = 2048) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._store: OrderedDict[str, tuple[float, str]] = OrderedDict()
        self._hits = 0
        self._misses = 0

    @property
    def enabled(self) -> bool:
        return self._ttl > 0

    @staticmethod
    def build_key(
        *,
        profile_id: str,
        revision: int | None,
        engine_id: str,
        engine_revision: str,
        request: TranslationRequest,
        segment_text: str,
        segment_context: str | None,
        strategy_version: str,
    ) -> str:
        options: TranslationOptions | None = request.options
        payload = {
            "profileId": profile_id,
            "revision": revision,
            "engineId": engine_id,
            "engineRevision": engine_revision,
            "sourceLanguage": request.source_language,
            "targetLanguage": request.target_language,
            "text": segment_text,
            "context": segment_context,
            "format": options.format if options else None,
            "preserveTerminology": options.preserve_terminology if options else None,
            "temperature": options.temperature if options else None,
            "strategyVersion": strategy_version,
        }
        blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

    def get(self, key: str) -> str | None:
        if not self.enabled:
            return None
        entry = self._store.get(key)
        if entry is None:
            self._misses += 1
            return None
        expires_at, value = entry
        if expires_at < time.monotonic():
            self._store.pop(key, None)
            self._misses += 1
            return None
        self._store.move_to_end(key)
        self._hits += 1
        return value

    def set(self, key: str, value: str) -> None:
        if not self.enabled:
            return
        self._store[key] = (time.monotonic() + self._ttl, value)
        self._store.move_to_end(key)
        while len(self._store) > self._max:
            self._store.popitem(last=False)

    @property
    def stats(self) -> dict[str, int]:
        return {
            "entries": len(self._store),
            "hits": self._hits,
            "misses": self._misses,
            "ttlSeconds": self._ttl,
        }
