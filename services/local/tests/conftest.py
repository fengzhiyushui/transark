"""pytest 共享 fixture。

- 隔离的数据目录与固定配对码，避免测试触碰真实用户数据；
- OCR/ASR 默认使用确定性引擎（无外部模型依赖）；
- 使用 starlette TestClient（随 lifespan 启动/停止长任务管理器）。
"""

from __future__ import annotations

import base64
import io
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from local_service.app import create_app
from local_service.settings import Settings

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures"

TEST_PAIRING_CODE = "TEST-PAIR-2026"


@pytest.fixture
def data_dir(tmp_path) -> Path:
    return tmp_path / "svc-data"


@pytest.fixture
def settings(data_dir: Path) -> Settings:
    return Settings(
        data_dir=data_dir,
        pairing_code=TEST_PAIRING_CODE,
        offline_probe=False,
        ocr_engine="mock",
        asr_engine="mock",
        max_concurrent_jobs=2,
        job_cancel_grace_seconds=0.5,
    )


@pytest.fixture
def app(settings: Settings):
    return create_app(settings)


@pytest.fixture
def client(app) -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers(client: TestClient) -> dict[str, str]:
    """完成配对并返回带 Bearer 令牌的请求头。"""
    response = client.post("/v1/pair", json={"pairingCode": TEST_PAIRING_CODE})
    assert response.status_code == 200, response.text
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def authed_client(client: TestClient, auth_headers: dict[str, str]) -> TestClient:
    """附带默认鉴权头的 TestClient（通过 headers 参数逐请求传递）。"""
    client.headers.update(auth_headers)
    return client


# ---------------------------------------------------------------- 样本构造工具
def make_docx_bytes(paragraphs: list[tuple[str, str | None]], tables: list | None = None) -> bytes:
    """构造 DOCX 样本：[(文本, 样式名)] + 可选表格数据。"""
    import docx

    document = docx.Document()
    for text, style in paragraphs:
        if style:
            document.add_paragraph(text, style=style)
        else:
            document.add_paragraph(text)
    for table_data in tables or []:
        table = document.add_table(rows=len(table_data), cols=len(table_data[0]))
        for r, row in enumerate(table_data):
            for c, value in enumerate(row):
                table.cell(r, c).text = value
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def make_pdf_bytes(pages: list[list[tuple[str, tuple[float, float]]]]) -> bytes:
    """构造 PDF 样本：每页为 [(文本, (x, y))]。"""
    import fitz

    document = fitz.open()
    for page_items in pages:
        page = document.new_page(width=612, height=792)
        for text, (x, y) in page_items:
            page.insert_text((x, y), text, fontsize=11)
    buffer = io.BytesIO()
    document.save(buffer)
    payload = buffer.getvalue()
    document.close()
    return payload


def make_wav_bytes(seconds: float = 1.0, sample_rate: int = 16000) -> bytes:
    """构造静音 WAV 样本（用于 ASR 时长解析）。"""
    frames = int(seconds * sample_rate)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(b"\x00\x00" * frames)
    return buffer.getvalue()


def make_png_bytes(width: int = 320, height: int = 240) -> bytes:
    """构造 PNG 样本。"""
    from PIL import Image

    image = Image.new("RGB", (width, height), color=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def b64(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")
