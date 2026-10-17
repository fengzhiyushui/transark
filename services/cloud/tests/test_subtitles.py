"""字幕提取与翻译（含 SSE 流式）。"""

from __future__ import annotations

from .conftest import srt_payload


def test_extract_srt(client):
    response = client.post(
        "/v1/subtitles/extract",
        json={"requestId": "req-extract", "filename": "demo.srt", "data": srt_payload()},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "upload"
    assert len(body["cues"]) == 2
    first = body["cues"][0]
    assert first["id"].startswith("cue-")
    assert first["startTime"] == 1.0
    assert first["endTime"] == 3.5
    assert "Welcome" in first["text"]


def test_extract_from_plain_text(client):
    response = client.post(
        "/v1/subtitles/extract",
        json={
            "requestId": "req-text",
            "text": "00:00:00,000 --> 00:00:02,000\nHello\n",
        },
    )
    assert response.status_code == 200
    assert response.json()["source"] == "text"
    assert len(response.json()["cues"]) == 1


def test_extract_without_payload_is_rejected(client):
    response = client.post("/v1/subtitles/extract", json={"requestId": "req-empty"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_extract_rejects_loopback_url(client):
    response = client.post(
        "/v1/subtitles/extract",
        json={"requestId": "req-ssrf", "url": "http://127.0.0.1:8765/health"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "POLICY_VIOLATION"


def test_extract_rejects_invalid_base64(client):
    response = client.post(
        "/v1/subtitles/extract",
        json={"requestId": "req-b64", "data": "!!!not-base64!!!"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_document_ocr_job_is_not_exposed(client):
    response = client.post(
        "/v1/jobs",
        json={"type": "document-ocr", "input": {"requestId": "j1", "imageData": "aGVsbG8="}},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_translate_alignment(client):
    response = client.post(
        "/v1/subtitles/translate",
        json={
            "requestId": "req-tr",
            "sourceLanguage": "en",
            "targetLanguage": "zh-CN",
            "segments": [
                {"id": "cue-1", "text": "Hello world."},
                {"id": "cue-2", "text": "Second line."},
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["requestId"] == "req-tr"
    assert [item["id"] for item in body["segments"]] == ["cue-1", "cue-2"]
    # custom-translate 内置词表对 “Hello world.” 返回固定译文，其余文本回退为 [lang] 原文
    assert body["segments"][0]["translation"] == "你好，世界。"
    assert body["segments"][1]["translation"] == "[zh-CN] Second line."


def test_translate_stream_sse(client):
    response = client.post(
        "/v1/subtitles/translate?stream=true",
        json={
            "requestId": "req-sse",
            "sourceLanguage": "en",
            "targetLanguage": "zh-CN",
            "segments": [{"id": "cue-1", "text": "Hello world."}],
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    text = response.text
    assert '"type": "start"' in text
    assert '"type": "segment"' in text
    assert '"type": "done"' in text
    assert '"id": "cue-1"' in text
    assert text.rstrip().endswith("[DONE]")
