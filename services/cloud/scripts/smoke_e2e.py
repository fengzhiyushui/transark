#!/usr/bin/env python
"""云端服务端到端冒烟：真实 HTTP + WebSocket。

两种模式：
  1. 自启服务（确定性 echo 翻译 + mock ASR，无需任何外部密钥）：
       python scripts/smoke_e2e.py --spawn
  2. 对接已运行的服务：
       python scripts/smoke_e2e.py --base-url https://cloud.example.com --api-key <key>

覆盖：健康检查、字幕提取、批量翻译、SSE 流式翻译、WS 流式 ASR。
退出码非 0 表示冒烟失败。
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import websockets

SRT = (
    "1\n"
    "00:00:01,000 --> 00:00:03,500\n"
    "Welcome to the demo.\n\n"
    "2\n"
    "00:00:04,000 --> 00:00:06,200\n"
    "This sentence has no subtitles yet.\n"
)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_health(base_url: str, timeout: float = 25.0) -> None:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            response = httpx.get(f"{base_url}/health", timeout=2.0)
            if response.status_code == 200:
                return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(0.4)
    raise RuntimeError(f"服务未在 {timeout}s 内就绪: {last_error}")


def check_http(base_url: str, api_key: str) -> None:
    headers = {"Authorization": f"Bearer {api_key}"}
    with httpx.Client(base_url=base_url, headers=headers, timeout=20.0) as client:
        extract = client.post(
            "/v1/subtitles/extract",
            json={
                "requestId": "smoke-extract",
                "filename": "smoke.srt",
                "data": base64.b64encode(SRT.encode("utf-8")).decode("ascii"),
            },
        )
        extract.raise_for_status()
        cues = extract.json()["cues"]
        assert len(cues) == 2, f"期望 2 条 cue，实际 {len(cues)}"
        print(f"  [ok] extract: {len(cues)} cues, first start={cues[0]['startTime']}")

        request = {
            "requestId": "smoke-translate",
            "sourceLanguage": "en",
            "targetLanguage": "zh-CN",
            "segments": [{"id": "cue-1", "text": "Hello world."}],
        }
        translated = client.post("/v1/subtitles/translate", json=request)
        translated.raise_for_status()
        body = translated.json()
        assert body["segments"][0]["id"] == "cue-1"
        assert body["segments"][0]["translation"]
        print(f"  [ok] translate: {body['segments'][0]['translation']!r}")

        streamed = client.post("/v1/subtitles/translate?stream=true", json=request)
        streamed.raise_for_status()
        assert '"type": "segment"' in streamed.text
        assert streamed.text.rstrip().endswith("[DONE]")
        print("  [ok] translate stream: SSE segment + [DONE]")


async def check_ws(base_url: str, api_key: str) -> None:
    ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://")
    async with websockets.connect(f"{ws_url}/v1/asr/stream", max_size=8 * 1024 * 1024) as socket_conn:
        await socket_conn.send(
            json.dumps(
                {
                    "type": "start",
                    "token": api_key,
                    "sessionId": "smoke-asr",
                    "sampleRate": 16000,
                    "targetLanguage": "zh-CN",
                }
            )
        )
        started = json.loads(await asyncio.wait_for(socket_conn.recv(), timeout=10))
        assert started["type"] == "started", started

        # 5.2 秒静音 PCM（mock 引擎按真实时长生成确定性 cue）
        await socket_conn.send(b"\x00\x00" * int(5.2 * 16000))

        cue = None
        translation = None
        deadline = time.time() + 15
        while time.time() < deadline and (cue is None or translation is None):
            message = json.loads(await asyncio.wait_for(socket_conn.recv(), timeout=10))
            if message.get("type") == "cue" and cue is None:
                cue = message["cue"]
            elif message.get("type") == "translation" and translation is None:
                translation = message["translation"]
            elif message.get("type") == "error":
                raise RuntimeError(f"ASR 错误: {message['error']}")

        assert cue and cue["text"], "未收到 ASR cue"
        assert translation, "未收到内联翻译"
        print(f"  [ok] asr: cue={cue['id']} {cue['startTime']}~{cue['endTime']}s -> {translation!r}")

        await socket_conn.send(json.dumps({"type": "stop"}))
        while True:
            message = json.loads(await asyncio.wait_for(socket_conn.recv(), timeout=10))
            if message.get("type") == "final":
                assert message["durationSec"] >= 5.0
                print(f"  [ok] asr final: {message['durationSec']}s")
                break


def run_checks(base_url: str, api_key: str) -> None:
    print(f"冒烟目标: {base_url}")
    check_http(base_url, api_key)
    asyncio.run(check_ws(base_url, api_key))
    print("端到端冒烟通过")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--spawn", action="store_true", help="自启本地服务（echo + mock）")
    args = parser.parse_args()

    process: subprocess.Popen | None = None
    temp_dir: tempfile.TemporaryDirectory | None = None

    try:
        if args.spawn or not args.base_url:
            port = free_port()
            base_url = f"http://127.0.0.1:{port}"
            api_key = "smoke-key"
            temp_dir = tempfile.TemporaryDirectory(prefix="transark-smoke-")
            env = dict(os.environ)
            env.update(
                {
                    "CLOUD_HOST": "127.0.0.1",
                    "CLOUD_PORT": str(port),
                    "CLOUD_API_KEYS": api_key,
                    "CLOUD_RATE_LIMIT_RPM": "1000",
                    "CLOUD_PROVIDER_PROTOCOL": "custom-translate",
                    "CLOUD_PROVIDER_BASE_URL": f"http://127.0.0.1:{port}/v1",
                    "CLOUD_PROVIDER_MODEL": "echo",
                    "CLOUD_PROVIDER_API_KEY": "",
                    "CLOUD_ASR_ENGINE": "mock",
                    "CLOUD_DATA_DIR": temp_dir.name,
                    "CLOUD_LOG_LEVEL": "WARNING",
                }
            )
            service_root = Path(__file__).resolve().parents[1]
            process = subprocess.Popen(
                [sys.executable, "-m", "cloud_service"],
                cwd=str(service_root),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.STDOUT,
            )
            wait_health(base_url)
        else:
            base_url = args.base_url.rstrip("/")
            api_key = args.api_key or ""
            if not api_key:
                raise SystemExit("对接外部服务时必须提供 --api-key")

        run_checks(base_url, api_key)
        return 0
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
        if temp_dir is not None:
            temp_dir.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
