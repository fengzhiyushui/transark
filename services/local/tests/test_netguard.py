"""网络出口守卫单元测试（数据合规核心机制）。"""

from __future__ import annotations

import httpx
import pytest

from local_service.models import AppError, ErrorCode
from local_service.netguard import NetworkGuard
from local_service.settings import Settings


def _settings(**overrides) -> Settings:
    base = {"data_dir": ":memory:", "pairing_code": "x", "offline_probe": False}
    base.update(overrides)
    return Settings(**base)


def test_loopback_is_always_allowed():
    guard = NetworkGuard(_settings())
    assert guard.classify("http://127.0.0.1:11434/api/chat") == "loopback"
    assert guard.classify("http://localhost:8765/v1") == "loopback"
    assert guard.classify("http://[::1]:8000/v1") == "loopback"
    assert guard.check_url("http://127.0.0.1:1/x", "device-only") == "loopback"


def test_private_address_requires_allow_lan():
    guard = NetworkGuard(_settings())
    url = "http://192.168.1.120:8000/v1"
    assert guard.classify(url) == "lan"
    assert guard.check_url(url, "allow-lan") == "lan"
    with pytest.raises(AppError) as exc_info:
        guard.check_url(url, "device-only")
    assert exc_info.value.code == ErrorCode.POLICY_VIOLATION


def test_cloud_requires_policy_and_user_authorization():
    guard = NetworkGuard(_settings(allow_cloud_egress=False))
    url = "https://api.openai.com/v1"
    assert guard.classify(url) == "cloud"
    with pytest.raises(AppError) as exc_info:
        guard.check_url(url, "allow-cloud")
    assert exc_info.value.code == ErrorCode.POLICY_VIOLATION
    assert guard.stats["blocked"] == 1

    authorized = NetworkGuard(_settings(allow_cloud_egress=True))
    assert authorized.check_url(url, "allow-cloud") == "cloud"
    assert authorized.stats["cloud"] == 1

    with pytest.raises(AppError):
        authorized.check_url(url, "device-only")


def test_offline_mode_blocks_everything_non_loopback():
    guard = NetworkGuard(_settings(offline_mode=True, allow_cloud_egress=False))
    with pytest.raises(AppError) as exc_info:
        guard.check_url("http://192.168.1.5/x", "allow-lan")
    assert exc_info.value.code == ErrorCode.POLICY_VIOLATION
    assert guard.stats["blocked"] == 1


def test_guard_client_blocks_before_request():
    """受守卫客户端在发出请求前即拦截违规 URL。"""

    async def scenario():
        guard = NetworkGuard(_settings(allow_cloud_egress=False))
        async with guard.client("device-only") as client:
            with pytest.raises(AppError) as exc_info:
                await client.get("https://api.openai.com/v1/models")
            assert exc_info.value.code == ErrorCode.POLICY_VIOLATION

    import asyncio

    asyncio.run(scenario())


def test_guard_client_allows_loopback_with_mock_transport():
    async def scenario():
        guard = NetworkGuard(_settings())
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            return httpx.Response(200, json={"ok": True})

        transport = httpx.MockTransport(handler)
        async with guard.client("device-only", transport=transport) as client:
            response = await client.get("http://127.0.0.1:8765/health")
            assert response.status_code == 200

        assert seen["url"] == "http://127.0.0.1:8765/health"
        assert guard.stats["loopback"] == 1

    import asyncio

    asyncio.run(scenario())


def test_processing_location_mapping():
    guard = NetworkGuard(_settings())
    assert guard.processing_location("http://127.0.0.1:11434") == "local"
    assert guard.processing_location("http://192.168.1.10:8000") == "lan"
    assert guard.processing_location("https://api.openai.com") == "cloud"
