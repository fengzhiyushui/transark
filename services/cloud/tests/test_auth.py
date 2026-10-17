"""API Key 鉴权与限流。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from cloud_service.app import create_app

from .conftest import make_settings


def _translate_body() -> dict:
    return {
        "requestId": "req-auth",
        "sourceLanguage": "en",
        "targetLanguage": "zh-CN",
        "segments": [{"id": "cue-1", "text": "Hello."}],
    }


def test_health_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_missing_key_is_rejected(app):
    with TestClient(app) as raw:
        response = raw.post("/v1/subtitles/translate", json=_translate_body())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"


def test_invalid_key_is_rejected(app):
    with TestClient(app) as raw:
        response = raw.post(
            "/v1/subtitles/translate",
            json=_translate_body(),
            headers={"Authorization": "Bearer wrong-key"},
        )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"


def test_rate_limit_returns_429(tmp_path):
    app = create_app(make_settings(tmp_path, rate_limit_rpm=2))
    with TestClient(app) as raw:
        headers = {"Authorization": "Bearer test-key"}
        first = raw.post("/v1/subtitles/translate", json=_translate_body(), headers=headers)
        second = raw.post("/v1/subtitles/translate", json=_translate_body(), headers=headers)
        third = raw.post("/v1/subtitles/translate", json=_translate_body(), headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    error = third.json()["error"]
    assert error["code"] == "RATE_LIMITED"
    assert error["details"]["retryAfterMs"] > 0


def test_rate_limit_falls_back_when_redis_unavailable(tmp_path):
    # 指向不存在的 Redis：初始化或首次计数失败后应回退到进程内限流
    app = create_app(
        make_settings(tmp_path, rate_limit_rpm=1, redis_url="redis://127.0.0.1:1/0")
    )
    with TestClient(app) as raw:
        headers = {"Authorization": "Bearer test-key"}
        first = raw.post("/v1/subtitles/translate", json=_translate_body(), headers=headers)
        second = raw.post("/v1/subtitles/translate", json=_translate_body(), headers=headers)
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "RATE_LIMITED"
