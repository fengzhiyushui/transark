"""云端 API Key 鉴权与限流。

与本地伴随服务的差异：
- 本地服务用「配对码换内存 Bearer 令牌」（防回环 CSRF）；
- 云端服务面向公网，改为「预共享 API Key + 令牌桶限流」。

Key 只通过 ``Authorization: Bearer <key>``（或 ``x-api-key``）传递，
日志不输出明文。WebSocket 无法在浏览器/扩展中自定义请求头，
因此 WS 通道允许在 ``start`` 帧或 ``?token=`` 查询参数中携带 Key。
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass

from fastapi import Request

from local_service.models import AppError, ErrorCode

from .settings import CloudSettings

logger = logging.getLogger("cloud_service.auth")


@dataclass
class CloudClient:
    """已通过鉴权的客户端身份。"""

    key_id: str
    anonymous: bool = False


class RateLimiter:
    """按 API Key 限流。

    配置 ``redis_url`` 时使用 Redis 固定窗口计数，支持多实例共享配额；
    Redis 不可用/超时时自动熔断回退到进程内滑动窗口，绝不因限流依赖
    故障而阻断正常翻译。
    """

    def __init__(self, rpm: int, redis_url: str | None = None) -> None:
        self._rpm = rpm
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._redis = None
        if redis_url:
            try:
                import redis  # type: ignore

                self._redis = redis.Redis.from_url(
                    redis_url, socket_timeout=0.5, socket_connect_timeout=0.5
                )
                logger.info("限流后端: Redis (%s)", redis_url)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Redis 限流初始化失败，使用进程内限流: %s", exc)

    def check(self, key_id: str) -> None:
        if self._redis is not None:
            try:
                self._check_redis(key_id)
                return
            except AppError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Redis 限流异常，熔断并回退进程内: %s", exc)
                self._redis = None
        self._check_memory(key_id)

    def _check_redis(self, key_id: str) -> None:
        window = int(time.time() // 60)
        key = f"transark:rl:{key_id}:{window}"
        pipe = self._redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, 120)
        count = int(pipe.execute()[0])
        if count > self._rpm:
            retry_after = max(1, 60 - int(time.time() % 60))
            raise AppError(
                ErrorCode.RATE_LIMITED,
                f"请求频率超限（{self._rpm} 次/分钟），请稍后重试",
                {"retryAfterMs": retry_after * 1000, "limitRpm": self._rpm},
            )

    def _check_memory(self, key_id: str) -> None:
        now = time.monotonic()
        with self._lock:
            events = self._events.setdefault(key_id, deque())
            while events and now - events[0] > 60.0:
                events.popleft()
            if len(events) >= self._rpm:
                retry_after = max(1, int(60.0 - (now - events[0]))) if events else 60
                raise AppError(
                    ErrorCode.RATE_LIMITED,
                    f"请求频率超限（{self._rpm} 次/分钟），请稍后重试",
                    {"retryAfterMs": retry_after * 1000, "limitRpm": self._rpm},
                )
            events.append(now)


def authenticate(settings: CloudSettings, token: str | None) -> CloudClient:
    """校验 API Key，返回客户端身份；失败抛出 AUTH_FAILED。"""
    keys = settings.parsed_api_keys()
    if not keys:
        if settings.allow_anonymous:
            return CloudClient(key_id="anonymous", anonymous=True)
        raise AppError(
            ErrorCode.AUTH_FAILED,
            "服务端未配置任何 API Key（CLOUD_API_KEYS），且未开启匿名开发模式",
        )
    if not token:
        raise AppError(
            ErrorCode.AUTH_FAILED,
            "缺少 API Key：请在请求头携带 Authorization: Bearer <key>",
        )
    for candidate in keys:
        if secrets.compare_digest(token, candidate):
            # 限流键使用摘要而非明文前缀，避免多 Key 前缀相同时共享配额
            digest = hashlib.sha256(candidate.encode("utf-8")).hexdigest()[:12]
            return CloudClient(key_id=f"key-{digest}")
    raise AppError(ErrorCode.AUTH_FAILED, "API Key 无效")


async def require_cloud_client() -> CloudClient:
    """鉴权依赖占位：应用工厂必须用 dependency_overrides 绑定真实实现。"""
    raise AppError(ErrorCode.INTERNAL_ERROR, "云端鉴权依赖未绑定（应用未正确初始化）")


def make_require_api_key(settings: CloudSettings, limiter: RateLimiter):
    """构造 FastAPI 依赖：API Key 鉴权 + 限流（用于覆盖本地服务的配对鉴权）。"""

    async def require_api_key(request: Request) -> CloudClient:
        token = _extract_token(request)
        client = authenticate(settings, token)
        limiter.check(client.key_id)
        return client

    return require_api_key


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    api_key = request.headers.get("x-api-key")
    if api_key:
        return api_key.strip()
    return request.query_params.get("token")
