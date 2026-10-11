"""长任务测试：创建 / 轮询 / 取消 / SSE / 404 与文件翻译全流程。"""

from __future__ import annotations

import base64
import io
import json
import time

import pytest
from fastapi.testclient import TestClient

from .conftest import b64, make_docx_bytes, make_png_bytes, make_wav_bytes
from . import contract_data


def _wait_for_terminal(
    client: TestClient, job_id: str, timeout: float = 15.0, headers: dict | None = None
) -> dict:
    """轮询任务直到终态。"""
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        response = client.get(f"/v1/jobs/{job_id}", headers=headers or {})
        assert response.status_code == 200, response.text
        last = response.json()
        if last["status"] in ("completed", "failed", "cancelled"):
            return last
        time.sleep(0.05)
    raise AssertionError(f"任务未在 {timeout}s 内进入终态: {last}")


# ---------------------------------------------------------------- OCR 任务
def test_document_ocr_job_lifecycle(authed_client: TestClient):
    png = make_png_bytes(320, 240)
    create = authed_client.post(
        "/v1/jobs",
        json={
            "type": "document-ocr",
            "input": {
                "requestId": "req-ocr-1",
                "imageData": b64(png),
                "mimeType": "image/png",
                "sourceLanguage": "en",
            },
        },
    )
    assert create.status_code == 201, create.text
    job = create.json()
    assert job["status"] == "pending"
    assert job["type"] == "document-ocr"
    assert job["id"]

    final = _wait_for_terminal(authed_client, job["id"])
    assert final["status"] == "completed"
    assert final["progress"]["progress"] == 100
    assert final["progress"]["stage"] == "completed"

    blocks = final["result"]["blocks"]
    assert len(blocks) == 3
    assert blocks[0]["readingOrder"] == 0
    assert len(blocks[0]["bbox"]) == 4
    # 与契约 mock OCR 数据对齐
    assert blocks[0]["text"] == contract_data.MOCK_OCR_BLOCKS[0]["text"]
    assert blocks[1]["bbox"] == contract_data.MOCK_OCR_BLOCKS[1]["bbox"]
    assert final["result"]["requestId"] == "req-ocr-1"


def test_document_ocr_job_rejects_invalid_input(authed_client: TestClient):
    create = authed_client.post(
        "/v1/jobs",
        json={"type": "document-ocr", "input": {"requestId": "x", "imageData": "!!!bad-base64!!!"}},
    )
    assert create.status_code == 422
    assert create.json()["error"]["code"] == "INVALID_REQUEST"
    assert create.json()["error"]["details"]["errors"]


# ---------------------------------------------------------------- ASR 任务
def test_video_asr_job_lifecycle(authed_client: TestClient):
    wav = make_wav_bytes(seconds=1.0)
    create = authed_client.post(
        "/v1/jobs",
        json={
            "type": "video-asr",
            "input": {
                "requestId": "req-asr-1",
                "audioData": b64(wav),
                "mediaSessionId": "media-tab-1",
                "generation": 1,
                "format": "wav",
                "sampleRate": 16000,
                "sourceLanguage": "en",
            },
        },
    )
    assert create.status_code == 201, create.text
    job = create.json()

    final = _wait_for_terminal(authed_client, job["id"])
    assert final["status"] == "completed"
    cues = final["result"]["cues"]
    assert len(cues) == 3
    for cue in cues:
        assert cue["endTime"] > cue["startTime"]
    # 时间轴按真实音频时长（1s）缩放
    assert cues[0]["startTime"] == 0.0
    assert final["result"]["durationSec"] == pytest.approx(1.0, abs=0.05)
    assert final["result"]["cues"][0]["text"] == contract_data.MOCK_ASR_CUES[0]["text"]


def test_video_asr_job_reports_missing_model_when_required(settings, tmp_path):
    """whisper.cpp 被强制指定但模型缺失时：任务失败且错误码明确。"""
    from local_service.app import create_app
    from local_service.settings import Settings

    strict = settings.model_copy(
        update={"asr_engine": "whisper-cpp", "asr_model_path": str(tmp_path / "missing.bin")}
    )
    with TestClient(create_app(strict)) as client:
        pair = client.post("/v1/pair", json={"pairingCode": "TEST-PAIR-2026"})
        headers = {"Authorization": f"Bearer {pair.json()['token']}"}

        create = client.post(
            "/v1/jobs",
            headers=headers,
            json={
                "type": "video-asr",
                "input": {"requestId": "req-asr-2", "audioData": b64(make_wav_bytes(0.2))},
            },
        )
        assert create.status_code == 201, create.text
        final = _wait_for_terminal(client, create.json()["id"], headers=headers)
        assert final["status"] == "failed"
        assert final["error"]["code"] == "MODEL_UNAVAILABLE"


# ---------------------------------------------------------------- 取消
def test_cancel_long_running_job(authed_client: TestClient, monkeypatch):
    """批量翻译任务可被取消：状态变为 cancelled 且错误码为 CANCELLED。

    通过 monkeypatch 注入逐段 sleep 的慢速引擎，确保取消窗口稳定可复现。
    """
    import asyncio

    from local_service.engines.echo import BuiltinEngine
    from local_service.models import TranslationResponse, TranslationSegmentResult

    async def slow_translate(self, request):
        results = []
        for segment in request.segments:
            await asyncio.sleep(0.05)
            results.append(
                TranslationSegmentResult(id=segment.id, translation=f"[zh] {segment.text}")
            )
        return TranslationResponse(
            requestId=request.request_id,
            segments=results,
            resolvedEngine=self.resolved_engine(),
        )

    monkeypatch.setattr(BuiltinEngine, "translate", slow_translate)

    segments = [{"id": f"seg-{i}", "text": f"Sentence number {i}."} for i in range(60)]
    create = authed_client.post(
        "/v1/jobs",
        json={
            "type": "batch-translation",
            "input": {
                "requestId": "req-batch-1",
                "sourceLanguage": "en",
                "targetLanguage": "zh-CN",
                "segments": segments,
            },
        },
    )
    assert create.status_code == 201, create.text
    job_id = create.json()["id"]

    # 等待进入 processing 后取消
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        current = authed_client.get(f"/v1/jobs/{job_id}").json()
        if current["status"] == "processing":
            break
        time.sleep(0.02)

    cancel = authed_client.post(f"/v1/jobs/{job_id}/cancel")
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["status"] == "cancelled"
    assert cancel.json()["error"]["code"] == "CANCELLED"

    # 终态任务再次取消是幂等的
    again = authed_client.post(f"/v1/jobs/{job_id}/cancel")
    assert again.status_code == 200
    assert again.json()["status"] == "cancelled"


def test_batch_translation_job_completes(authed_client: TestClient):
    segments = [{"id": f"seg-{i}", "text": f"Line {i}"} for i in range(5)]
    create = authed_client.post(
        "/v1/jobs",
        json={
            "type": "batch-translation",
            "input": {
                "requestId": "req-batch-2",
                "sourceLanguage": "en",
                "targetLanguage": "zh-CN",
                "segments": segments,
            },
        },
    )
    assert create.status_code == 201
    final = _wait_for_terminal(authed_client, create.json()["id"])
    assert final["status"] == "completed"
    assert [seg["id"] for seg in final["result"]["segments"]] == [f"seg-{i}" for i in range(5)]
    assert all(seg["translation"] for seg in final["result"]["segments"])


# ---------------------------------------------------------------- 文件翻译全流程
def test_file_translation_job_end_to_end(authed_client: TestClient):
    docx_payload = make_docx_bytes(
        paragraphs=[
            ("Hello world.", None),
            ("This is a sample document for translation testing.", None),
            ("Offline translation preserves your privacy and keeps your data on-device.", None),
        ]
    )
    create = authed_client.post(
        "/v1/jobs",
        json={
            "type": "file-translation",
            "input": {
                "filename": "sample.docx",
                "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "data": b64(docx_payload),
                "sourceLanguage": "en",
                "targetLanguage": "zh-CN",
                "profileId": "local-companion-service",
                "exportFormat": "docx",
                "exportLayout": "bilingual",
                "title": "Sample",
            },
        },
    )
    assert create.status_code == 201, create.text
    job_id = create.json()["id"]

    # 通过 SSE 历史回放验证阶段推进（轮询可能错过快速完成的中间态）
    events = []
    with authed_client.stream("GET", f"/v1/jobs/{job_id}/events") as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: "):]))
                if events[-1]["status"] in ("completed", "failed", "cancelled"):
                    break
    stages_seen = {event.get("stage") for event in events}
    assert "parsing" in stages_seen
    assert "translating" in stages_seen
    assert "exporting" in stages_seen
    assert events[-1]["status"] == "completed"

    final = authed_client.get(f"/v1/jobs/{job_id}").json()
    assert final["status"] == "completed"

    result = final["result"]
    assert result["unitCount"] == 3
    translations = {seg["id"]: seg["translation"] for seg in result["translation"]["segments"]}
    assert len(translations) == 3
    assert translations["dx-0000"] == "你好，世界。"

    export = result["export"]
    assert export["filename"].endswith(".docx")
    payload = base64.b64decode(export["data"])

    import docx

    document = docx.Document(io.BytesIO(payload))
    texts = [p.text for p in document.paragraphs if p.text.strip()]
    assert "Sample" in texts
    assert "你好，世界。" in texts
    assert "Hello world." in texts


def test_job_list_and_filters(authed_client: TestClient):
    create = authed_client.post(
        "/v1/jobs",
        json={
            "type": "document-ocr",
            "input": {"requestId": "req-ocr-list", "imageData": b64(make_png_bytes())},
        },
    )
    job_id = create.json()["id"]
    _wait_for_terminal(authed_client, job_id)

    listing = authed_client.get("/v1/jobs", params={"type": "document-ocr"})
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert body["total"] >= 1
    assert all(job["type"] == "document-ocr" for job in body["jobs"])

    completed = authed_client.get("/v1/jobs", params={"status": "completed"})
    assert completed.status_code == 200
    assert all(job["status"] == "completed" for job in completed.json()["jobs"])


def test_get_unknown_job_returns_404(authed_client: TestClient):
    response = authed_client.get("/v1/jobs/job-does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_cancel_unknown_job_returns_404(authed_client: TestClient):
    response = authed_client.post("/v1/jobs/job-does-not-exist/cancel")
    assert response.status_code == 404


def test_create_job_with_unknown_type(authed_client: TestClient):
    response = authed_client.post("/v1/jobs", json={"type": "no-such-type", "input": {}})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_sse_event_stream_reaches_terminal(authed_client: TestClient):
    create = authed_client.post(
        "/v1/jobs",
        json={
            "type": "document-ocr",
            "input": {"requestId": "req-ocr-sse", "imageData": b64(make_png_bytes())},
        },
    )
    job_id = create.json()["id"]

    events = []
    with authed_client.stream("GET", f"/v1/jobs/{job_id}/events") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: "):]))
                if events[-1]["status"] in ("completed", "failed", "cancelled"):
                    break

    assert events, "SSE 流未产生任何事件"
    assert events[-1]["status"] == "completed"
    assert events[-1]["progress"] == 100
    assert all(event["jobId"] == job_id for event in events)
