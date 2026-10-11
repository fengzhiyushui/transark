"""网络出口守卫（数据合规核心）。

所有引擎发起的 HTTP 请求必须经过本模块创建的客户端：
- 回环地址（127.0.0.0/8、::1、localhost）：始终允许；
- 局域网私有地址：仅 ``allow-lan`` 数据策略允许；
- 公网地址：仅 ``allow-cloud`` 数据策略且用户显式开启
  ``allow_cloud_egress`` 时才允许；
- ``offline_mode=true``：除回环外一律拒绝。

任何被拒绝的请求都会抛出 AppError(POLICY_VIOLATION)，
保证"绝不在未经用户授权下静默向外网回退"。
守卫同时统计出口流量，供离线自检端点报告。
"""

from __future__ import annotations

import ipaddress
from collections import Counter
from urllib.parse import urlparse

import httpx

from .models import AppError, DataPolicy, ErrorCode
from .settings import Settings, is_loopback_host


def _is_private_host(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_private
    except ValueError:
        return host.endswith(".local") or host.endswith(".lan") or host.endswith(".internal")


class NetworkGuard:
    """统一的出站请求守卫。"""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._stats: Counter[str] = Counter()

    # ------------------------------------------------------------------ stats
    @property
    def stats(self) -> dict[str, int]:
        return {
            "loopback": self._stats.get("loopback", 0),
            "lan": self._stats.get("lan", 0),
            "cloud": self._stats.get("cloud", 0),
            "blocked": self._stats.get("blocked", 0),
        }

    # ------------------------------------------------------------------ check
    def classify(self, url: str) -> str:
        """把 URL 分类为 loopback / lan / cloud。"""
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if is_loopback_host(host):
            return "loopback"
        if _is_private_host(host):
            return "lan"
        return "cloud"

    def processing_location(self, url: str) -> str:
        """按地址推断"实际处理位置"（契约 ProcessingLocation）。

        注意：地址只能给出拓扑分类，真实处理位置仍以配置声明为准；
        无法推断时引擎会返回 'unverified'。
        """
        return "local" if self.classify(url) == "loopback" else self.classify(url)

    def check_url(self, url: str, data_policy: DataPolicy, *, purpose: str = "request") -> str:
        """校验 URL 是否允许访问，返回分类；不允许时抛出 POLICY_VIOLATION。"""
        category = self.classify(url)
        if category == "loopback":
            self._stats["loopback"] += 1
            return category

        if self._settings.offline_mode:
            self._stats["blocked"] += 1
            raise AppError(
                ErrorCode.POLICY_VIOLATION,
                f"离线模式已启用，拒绝{purpose}非回环地址: {url}",
                {"url": url, "category": category, "dataPolicy": data_policy},
            )

        if category == "lan":
            if data_policy in ("allow-lan", "allow-cloud"):
                self._stats["lan"] += 1
                return category
            self._stats["blocked"] += 1
            raise AppError(
                ErrorCode.POLICY_VIOLATION,
                f"数据策略 {data_policy!r} 禁止访问局域网地址: {url}",
                {"url": url, "category": category, "dataPolicy": data_policy},
            )

        # cloud
        if data_policy == "allow-cloud" and self._settings.allow_cloud_egress:
            self._stats["cloud"] += 1
            return category
        self._stats["blocked"] += 1
        raise AppError(
            ErrorCode.POLICY_VIOLATION,
            (
                f"数据策略 {data_policy!r} 禁止公网出口（或用户未授权云端出口），"
                f"拒绝{purpose}: {url}"
            ),
            {
                "url": url,
                "category": category,
                "dataPolicy": data_policy,
                "allowCloudEgress": self._settings.allow_cloud_egress,
            },
        )

    # ----------------------------------------------------------------- client
    def client(
        self, data_policy: DataPolicy, *, timeout: float | httpx.Timeout | None = None, **kwargs
    ) -> httpx.AsyncClient:
        """创建受守卫保护的 httpx 异步客户端。

        每个请求发出前都会经过 :meth:`check_url`；测试可通过
        ``transport=httpx.MockTransport(handler)`` 注入假响应而不触发真实网络。
        """

        async def _guard_hook(request: httpx.Request) -> None:
            self.check_url(str(request.url), data_policy)

        event_hooks = dict(kwargs.pop("event_hooks", {}) or {})
        request_hooks = list(event_hooks.get("request", []))
        request_hooks.append(_guard_hook)
        event_hooks["request"] = request_hooks

        if timeout is None:
            timeout = httpx.Timeout(30.0, connect=5.0)
        return httpx.AsyncClient(timeout=timeout, event_hooks=event_hooks, **kwargs)
