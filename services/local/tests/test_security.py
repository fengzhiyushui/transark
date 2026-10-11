"""配对鉴权与健康检查测试。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from .conftest import TEST_PAIRING_CODE


def test_health_is_public_and_reports_loopback(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "local-companion-service"
    assert body["loopbackOnly"] is True
    assert body["pairingRequired"] is True
    assert body["port"] == 8765


def test_protected_endpoint_requires_token(client: TestClient):
    response = client.post(
        "/v1/translate",
        json={
            "requestId": "req-1",
            "sourceLanguage": "en",
            "targetLanguage": "zh-CN",
            "segments": [{"id": "seg-1", "text": "Hello"}],
        },
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"


def test_pair_with_wrong_code_is_rejected(client: TestClient):
    response = client.post("/v1/pair", json={"pairingCode": "WRONG-CODE"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"


def test_pair_success_issues_bearer_token(client: TestClient):
    response = client.post(
        "/v1/pair",
        json={
            "pairingCode": TEST_PAIRING_CODE,
            "clientId": "extension-test",
            "clientName": "WXT Extension (test)",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tokenType"] == "Bearer"
    assert body["token"]
    assert body["expiresAt"] > body["issuedAt"]
    assert body["loopbackOnly"] is True


def test_invalid_token_is_rejected(client: TestClient):
    response = client.get(
        "/v1/providers", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"


def test_pairing_lockout_after_repeated_failures(client: TestClient):
    for _ in range(5):
        client.post("/v1/pair", json={"pairingCode": "WRONG"})
    locked = client.post("/v1/pair", json={"pairingCode": TEST_PAIRING_CODE})
    assert locked.status_code == 401
    assert locked.json()["error"]["details"]["retryAfterSeconds"] >= 1


def test_capabilities_endpoint_declares_service_abilities(client: TestClient):
    response = client.get("/v1/capabilities")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["service"] == "local-companion-service"
    assert "ollama" in body["protocols"]
    assert "custom-translate" in body["protocols"]
    assert "document-ocr" in body["jobTypes"]
    assert "video-asr" in body["jobTypes"]
    assert "file-translation" in body["jobTypes"]
    assert "docx" in body["documentFormats"]
    assert body["ocr"] is True and body["asr"] is True


def test_providers_list_includes_builtin_seeds(authed_client: TestClient):
    response = authed_client.get("/v1/providers")
    assert response.status_code == 200, response.text
    profiles = {item["profileId"]: item for item in response.json()}
    assert "local-companion-service" in profiles
    assert profiles["local-companion-service"]["dataPolicy"] == "device-only"
    assert profiles["local-companion-service"]["processingLocation"] == "local"
    assert "local-ollama-qwen" in profiles
    assert profiles["local-ollama-qwen"]["protocol"] == "ollama"
