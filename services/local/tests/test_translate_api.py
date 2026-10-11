"""POST /v1/translate 端点测试（含契约 mock 样本验证）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from . import contract_data


def _translate_payload(**overrides):
    payload = dict(contract_data.MOCK_TRANSLATION_REQUEST)
    payload.update(overrides)
    return payload


def test_translate_with_contract_mock_samples(authed_client: TestClient):
    """针对契约 mock 样本验证 /v1/translate：结果与请求严格对齐。

    契约 mock 请求中的 profileId 指向 Ollama；此处改用内置混合引擎
    （device-only、完全本地）以获得确定性的契约 mock 译文。
    """
    response = authed_client.post(
        "/v1/translate", json=_translate_payload(profileId="local-companion-service")
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["requestId"] == contract_data.MOCK_TRANSLATION_REQUEST["requestId"]
    assert [seg["id"] for seg in body["segments"]] == ["seg-1", "seg-2", "seg-3"]
    for segment in body["segments"]:
        expected = contract_data.MOCK_TRANSLATION_EXPECTED[segment["id"]]
        assert segment["translation"] == expected
        assert "error" not in segment or segment.get("error") is None

    engine = body["resolvedEngine"]
    assert engine["id"].startswith("built-in/")
    assert engine["actualLocation"] == "local"


def test_translate_contract_mock_profile_routes_to_ollama(authed_client: TestClient):
    """契约 mock 的 profileId（local-ollama-qwen）路由到 Ollama 适配器。

    本机未运行 Ollama 时应返回明确的 NETWORK_ERROR，而不是静默切换引擎。
    """
    response = authed_client.post("/v1/translate", json=_translate_payload())
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "NETWORK_ERROR"


def test_translate_default_profile_when_profile_id_missing(authed_client: TestClient):
    payload = _translate_payload(profileId=None)
    response = authed_client.post("/v1/translate", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["resolvedEngine"]["actualLocation"] == "local"


def test_translate_rejects_duplicate_segment_ids(authed_client: TestClient):
    payload = _translate_payload(
        segments=[
            {"id": "seg-1", "text": "Hello"},
            {"id": "seg-1", "text": "World"},
        ]
    )
    response = authed_client.post("/v1/translate", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_translate_rejects_empty_segments(authed_client: TestClient):
    response = authed_client.post("/v1/translate", json=_translate_payload(segments=[]))
    assert response.status_code == 422


def test_translate_unknown_profile_returns_not_found(authed_client: TestClient):
    response = authed_client.post("/v1/translate", json=_translate_payload(profileId="no-such"))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_translate_unsupported_protocol_rejected(authed_client: TestClient):
    """登记一个不支持的协议后，请求必须得到 UNSUPPORTED_PROTOCOL 而非伪装兼容。"""
    put = authed_client.put(
        "/v1/providers/weird-gateway",
        json={
            "profileId": "weird-gateway",
            "revision": 1,
            "name": "Weird Gateway",
            "protocol": "openai-responses",
            "baseUrl": "http://127.0.0.1:9/v1",
            "model": "m",
            "auth": {"type": "none"},
            "dataPolicy": "device-only",
            "capabilities": {"textTranslation": True},
        },
    )
    assert put.status_code == 200, put.text

    response = authed_client.post("/v1/translate", json=_translate_payload(profileId="weird-gateway"))
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "UNSUPPORTED_PROTOCOL"


def test_device_only_policy_blocks_cloud_profile(authed_client: TestClient):
    """device-only 策略禁止指向公网端点：执行前即拒绝，不发生任何请求。"""
    put = authed_client.put(
        "/v1/providers/cloud-misconfigured",
        json={
            "profileId": "cloud-misconfigured",
            "revision": 1,
            "name": "Cloud (misconfigured)",
            "protocol": "openai-chat",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "auth": {"type": "none"},
            "dataPolicy": "device-only",
            "deploymentLocation": "cloud",
            "processingLocation": "cloud",
            "capabilities": {"textTranslation": True},
        },
    )
    assert put.status_code == 200, put.text

    response = authed_client.post("/v1/translate", json=_translate_payload(profileId="cloud-misconfigured"))
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "POLICY_VIOLATION"


def test_cloud_profile_without_user_authorization_is_blocked(authed_client: TestClient):
    """allow-cloud 策略但用户未开启云端出口：同样拒绝（无静默回退）。"""
    put = authed_client.put(
        "/v1/providers/cloud-byok",
        json={
            "profileId": "cloud-byok",
            "revision": 1,
            "name": "Cloud BYOK",
            "protocol": "openai-chat",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "auth": {"type": "none"},
            "dataPolicy": "allow-cloud",
            "deploymentLocation": "cloud",
            "processingLocation": "cloud",
            "capabilities": {"textTranslation": True},
        },
    )
    assert put.status_code == 200

    response = authed_client.post("/v1/translate", json=_translate_payload(profileId="cloud-byok"))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "POLICY_VIOLATION"


def test_ollama_unreachable_returns_network_error(authed_client: TestClient):
    """本机 Ollama 未运行时返回明确的 NETWORK_ERROR（不静默切换引擎）。"""
    response = authed_client.post("/v1/translate", json=_translate_payload(profileId="local-ollama-qwen"))
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "NETWORK_ERROR"


def test_provider_registration_roundtrip(authed_client: TestClient):
    config = {
        "profileId": "lan-vllm",
        "revision": 3,
        "name": "LAN vLLM Gateway",
        "protocol": "openai-chat",
        "baseUrl": "http://192.168.1.120:8000/v1",
        "model": "Qwen/Qwen2.5-14B-Instruct",
        "auth": {"type": "bearer", "token": "lan-test-key-001"},
        "dataPolicy": "allow-lan",
        "deploymentLocation": "lan",
        "processingLocation": "lan",
        "capabilities": {"textTranslation": True, "streaming": True},
        "limits": {"concurrency": 8, "timeoutMs": 60000},
        "enabled": True,
    }
    put = authed_client.put("/v1/providers/lan-vllm", json=config)
    assert put.status_code == 200, put.text
    assert put.json()["revision"] == 3

    fetched = authed_client.get("/v1/providers/lan-vllm")
    assert fetched.status_code == 200
    assert fetched.json()["baseUrl"] == "http://192.168.1.120:8000/v1"

    deleted = authed_client.delete("/v1/providers/lan-vllm")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    missing = authed_client.get("/v1/providers/lan-vllm")
    assert missing.status_code == 404


def test_provider_put_rejects_id_mismatch(authed_client: TestClient):
    config = {
        "profileId": "other-id",
        "revision": 1,
        "name": "X",
        "protocol": "ollama",
        "baseUrl": "http://127.0.0.1:11434",
        "model": "m",
        "auth": {"type": "none"},
        "dataPolicy": "device-only",
        "capabilities": {"textTranslation": True},
    }
    response = authed_client.put("/v1/providers/path-id", json=config)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
