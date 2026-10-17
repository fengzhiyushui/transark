"""缓存后端：进程内 LRU（默认）或 Redis（配置 CLOUD_REDIS_URL 时）。

两种实现保持与 ``local_service.cache.TranslationCache`` 相同的
``get``/``set``/``stats`` 接口，翻译编排层无需感知差异。
Redis 不可用时自动回退到进程内缓存，并输出告警日志——
缓存是性能优化而非正确性依赖，绝不允许因缓存故障导致翻译失败。
"""

from __future__ import annotations

import logging
from typing import Any

from local_service.cache import TranslationCache

from .settings import CloudSettings

logger = logging.getLogger("cloud_service.cache")


class RedisTranslationCache(TranslationCache):
    """Redis 译文缓存（继承进程内实现作为兜底）。"""

    def __init__(self, url: str, *, ttl_seconds: int, fallback: TranslationCache) -> None:
        # 复用父类的键构造（build_key 为静态方法）；自身存储由 Redis 承担
        super().__init__(ttl_seconds=ttl_seconds, max_entries=1)
        self._fallback = fallback
        self._ttl = ttl_seconds
        import redis  # type: ignore

        self._redis = redis.Redis.from_url(url, socket_timeout=2.0, socket_connect_timeout=2.0)

    def get(self, key: str) -> str | None:
        try:
            value = self._redis.get(f"transark:tr:{key}")
            if value is not None:
                return value.decode("utf-8")
        except Exception as exc:  # noqa: BLE001 - 缓存故障不阻断翻译
            logger.warning("Redis 读取失败，回退进程内缓存: %s", exc)
        return self._fallback.get(key)

    def set(self, key: str, value: str) -> None:
        self._fallback.set(key, value)
        try:
            self._redis.set(f"transark:tr:{key}", value, ex=max(1, self._ttl))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis 写入失败（已写入进程内缓存）: %s", exc)

    @property
    def stats(self) -> dict[str, Any]:
        base = dict(self._fallback.stats)
        base["backend"] = "redis"
        return base


def build_cache(settings: CloudSettings) -> TranslationCache:
    """按配置构造缓存后端。"""
    memory = TranslationCache(
        ttl_seconds=settings.cache_ttl_seconds,
        max_entries=settings.cache_max_entries,
    )
    if not settings.redis_url:
        return memory
    try:
        cache = RedisTranslationCache(
            settings.redis_url,
            ttl_seconds=settings.cache_ttl_seconds,
            fallback=memory,
        )
        logger.info("译文缓存后端: Redis (%s)", settings.redis_url)
        return cache
    except ImportError:
        logger.warning("未安装 redis 包（pip install redis），使用进程内缓存")
        return memory
    except Exception as exc:  # noqa: BLE001 - 连接失败在首次读写时再降级
        logger.warning("Redis 初始化失败，使用进程内缓存: %s", exc)
        return memory
