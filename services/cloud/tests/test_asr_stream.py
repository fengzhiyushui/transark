"""流式 ASR WebSocket。"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


def _pcm_bytes(seconds: float, sample_rate: int = 16000) -> bytes:
    return b"\x00\x00" * int(seconds * sample_rate)


def _receive_until(ws, wanted: str, limit: int = 20) -> dict:
    for _ in range(limit):
        message = ws.receive_json()
        if message.get("type") == wanted:
            return message
    raise AssertionError(f"未收到类型为 {wanted} 的消息")


def test_websocket_rejects_invalid_token(app):
    with TestClient(app) as raw:
        with raw.websocket_connect("/v1/asr/stream?token=bad-key") as ws:
            ws.send_json({"type": "start", "sessionId": "s-bad", "sampleRate": 16000})
            message = ws.receive_json()
    assert message["type"] == "error"
    assert message["error"]["code"] == "AUTH_FAILED"


def test_streaming_asr_emits_cues_and_optional_translation(client):
    with client.websocket_connect("/v1/asr/stream?token=test-key") as ws:
        ws.send_json(
            {
                "type": "start",
                "sessionId": "s-1",
                "sampleRate": 16000,
                "sourceLanguage": "en",
                "targetLanguage": "zh-CN",
            }
        )
        assert ws.receive_json()["type"] == "started"

        ws.send_bytes(_pcm_bytes(5.2))
        cue_message = _receive_until(ws, "cue")
        cue = cue_message["cue"]
        assert cue["id"].startswith("cue-")
        assert cue["endTime"] >= cue["startTime"] >= 0
        assert cue["text"]

        translation_message = _receive_until(ws, "translation")
        assert translation_message["cueId"] == cue["id"]
        assert translation_message["translation"].startswith("[zh-CN]")

        ws.send_json({"type": "stop"})
        final = _receive_until(ws, "final")
        assert final["sessionId"] == "s-1"
        assert final["durationSec"] >= 5.0


def test_streaming_asr_without_target_language_skips_translation(client):
    with client.websocket_connect("/v1/asr/stream?token=test-key") as ws:
        ws.send_json({"type": "start", "sessionId": "s-2", "sampleRate": 16000})
        assert ws.receive_json()["type"] == "started"
        ws.send_bytes(_pcm_bytes(5.2))
        cue = _receive_until(ws, "cue")
        assert cue["cue"]["text"]
        ws.send_json({"type": "stop"})
        assert _receive_until(ws, "final")["type"] == "final"


def test_websocket_requires_start_frame(client):
    with client.websocket_connect("/v1/asr/stream?token=test-key") as ws:
        ws.send_text(json.dumps({"type": "audio"}))
        message = ws.receive_json()
    assert message["type"] == "error"
    assert message["error"]["code"] == "INVALID_REQUEST"
