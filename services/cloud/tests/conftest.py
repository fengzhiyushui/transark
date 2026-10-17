"""pytest 共享夹具：用确定性 echo Profile 与 mock ASR 构造云端应用。"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from cloud_service.app import create_app
from cloud_service.settings import CloudSettings

ECHO_PROFILE = {
    "profileId": "cloud-echo",
    "revision": 1,
    "name": "Deterministic Echo (tests)",
    "protocol": "custom-translate",
    "baseUrl": "http://127.0.0.1:8780/v1",
    "model": "echo",
    "auth": {"type": "none"},
    "dataPolicy": "device-only",
    "deploymentLocation": "loopback",
    "processingLocation": "local",
    "capabilities": {
        "textTranslation": True,
        "ocr": False,
        "asr": False,
        "streaming": False,
        "structuredOutput": True,
    },
    "enabled": True,
}


def make_settings(tmp_path, **overrides) -> CloudSettings:
    values = {
        "api_keys": "test-key",
        "allow_anonymous": False,
        "rate_limit_rpm": 1000,
        "asr_engine": "mock",
        "providers_json": json.dumps([ECHO_PROFILE]),
        "default_profile_id": "cloud-echo",
        "data_dir": tmp_path / "data",
        "cache_ttl_seconds": 0,
    }
    values.update(overrides)
    return CloudSettings(**values)


@pytest.fixture
def app(tmp_path):
    return create_app(make_settings(tmp_path))


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        test_client.headers.update({"Authorization": "Bearer test-key"})
        yield test_client


def srt_payload() -> str:
    import base64

    content = (
        "1\n"
        "00:00:01,000 --> 00:00:03,500\n"
        "Welcome to the demo.\n\n"
        "2\n"
        "00:00:04,000 --> 00:00:06,200\n"
        "This sentence has no subtitles yet.\n"
    )
    return base64.b64encode(content.encode("utf-8")).decode("ascii")
