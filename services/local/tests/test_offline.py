"""离线自检与数据合规测试。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from local_service.app import create_app
from local_service.models import AppError, ErrorCode
from local_service.settings import Settings


def test_offline_status_reports_local_engines(authed_client: TestClient):
    response = authed_client.get("/v1/offline/status")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["loopbackOnly"] is True
    assert body["silentFallbackPolicy"] == "forbidden"
    assert body["cloudEgressAllowed"] is False
    assert body["offlineMode"] is False

    # 本地引擎可用性
    assert body["localEnginesAvailable"]["textTranslation"] is True

    # 出口流量统计存在且初始为零
    egress = body["egress"]
    assert set(egress) == {"loopback", "lan", "cloud", "blocked"}

    # 引擎明细：内置引擎标记为本地
    engines = {item["profileId"]: item for item in body["engines"]}
    assert engines["local-companion-service"]["isLocal"] is True
    assert engines["local-companion-service"]["actualLocation"] == "local"
    assert engines["local-ollama-qwen"]["addressCategory"] == "loopback"


def test_offline_verify_passes_in_local_configuration(authed_client: TestClient):
    response = authed_client.post("/v1/offline/verify")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["verified"] is True
    names = {check["name"] for check in body["checks"]}
    assert "loopback-bind" in names
    assert "egress-guard-enforced" in names
    assert "local-translation-smoke" in names
    smoke = next(c for c in body["checks"] if c["name"] == "local-translation-smoke")
    assert smoke["passed"] is True


def test_offline_mode_blocks_non_loopback_requests(tmp_path):
    """offline_mode=true 时，即使 allow-lan/allow-cloud 策略也被拒绝。"""
    settings = Settings(
        data_dir=tmp_path / "svc-offline",
        pairing_code="TEST-PAIR-2026",
        offline_probe=False,
        offline_mode=True,
    )
    with TestClient(create_app(settings)) as client:
        pair = client.post("/v1/pair", json={"pairingCode": "TEST-PAIR-2026"})
        headers = {"Authorization": f"Bearer {pair.json()['token']}"}

        # 登记一个 allow-lan 的局域网网关
        put = client.put(
            "/v1/providers/lan-gateway-offline",
            headers=headers,
            json={
                "profileId": "lan-gateway-offline",
                "revision": 1,
                "name": "LAN gateway",
                "protocol": "openai-chat",
                "baseUrl": "http://192.168.1.120:8000/v1",
                "model": "m",
                "auth": {"type": "none"},
                "dataPolicy": "allow-lan",
                "deploymentLocation": "lan",
                "processingLocation": "lan",
                "capabilities": {"textTranslation": True},
            },
        )
        assert put.status_code == 200

        response = client.post(
            "/v1/translate",
            headers=headers,
            json={
                "requestId": "req-offline-1",
                "sourceLanguage": "en",
                "targetLanguage": "zh-CN",
                "segments": [{"id": "seg-1", "text": "Hello"}],
                "profileId": "lan-gateway-offline",
            },
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "POLICY_VIOLATION"

        status = client.get("/v1/offline/status", headers=headers).json()
        assert status["offlineMode"] is True
        assert status["egress"]["blocked"] >= 1


def test_offline_mode_rejects_cloud_egress_configuration(tmp_path):
    """offline_mode 与 allow_cloud_egress 同时开启属于配置错误，启动即拒绝。"""
    import pytest

    with pytest.raises(Exception):
        Settings(
            data_dir=tmp_path / "svc-bad",
            pairing_code="x",
            offline_mode=True,
            allow_cloud_egress=True,
        )


def test_non_loopback_bind_is_rejected_by_default(tmp_path):
    """服务默认拒绝绑定非回环地址。"""
    import pytest

    with pytest.raises(Exception):
        Settings(data_dir=tmp_path / "svc-bind", pairing_code="x", host="0.0.0.0")


def test_cloud_egress_allowed_with_explicit_authorization(tmp_path):
    """用户显式授权云端出口后，allow-cloud 策略才不会被守卫拦截。"""
    settings = Settings(
        data_dir=tmp_path / "svc-cloud",
        pairing_code="TEST-PAIR-2026",
        offline_probe=False,
        allow_cloud_egress=True,
    )
    with TestClient(create_app(settings)) as client:
        pair = client.post("/v1/pair", json={"pairingCode": "TEST-PAIR-2026"})
        headers = {"Authorization": f"Bearer {pair.json()['token']}"}

        status = client.get("/v1/offline/status", headers=headers).json()
        assert status["cloudEgressAllowed"] is True

        # 守卫生效：显式授权后 allow-cloud 策略放行公网地址
        services = client.app.state.services
        assert services.guard.check_url("https://api.openai.com/v1", "allow-cloud") == "cloud"
        # device-only 策略仍然被拒绝
        with pytest.raises(AppError) as exc_info:
            services.guard.check_url("https://api.openai.com/v1", "device-only")
        assert exc_info.value.code == ErrorCode.POLICY_VIOLATION
