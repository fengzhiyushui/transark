"""流式 ASR WebSocket 端点：``/v1/asr/stream``。

协议（文本帧为 JSON，二进制帧为 16kHz 单声道 int16 PCM）：

- 客户端 → ``{"type":"start","sessionId","sampleRate","sourceLanguage","targetLanguage","token"}``
  （WS 无法自定义请求头，token 也可以经 ``?token=`` 查询参数传递）
- 服务端 → ``{"type":"cue","sessionId","cue":{id,startTime,endTime,text,confidence?}}``
- 服务端 → ``{"type":"translation","sessionId","cueId","translation"}``（声明 targetLanguage 时）
- 客户端 → ``{"type":"stop"}``
- 服务端 → ``{"type":"final","sessionId","durationSec}`` 并关闭
- 任何失败 → ``{"type":"error","error":{code,message}}``（鉴权失败关闭码 4401）
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from local_service.models import AppError, ErrorCode

from ..asr_stream import AsrStreamSession
from ..auth import authenticate

logger = logging.getLogger("cloud_service.asr")

router = APIRouter(tags=["asr"])

_MAX_SESSION_SECONDS = 4 * 3600  # 单会话最长 4 小时


@router.websocket("/v1/asr/stream")
async def asr_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    services = websocket.app.state.services
    settings = websocket.app.state.cloud_settings
    limiter = websocket.app.state.rate_limiter

    # ---- 1. 握手帧 ----
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        start = json.loads(raw)
    except (asyncio.TimeoutError, json.JSONDecodeError, ValueError):
        await _send_error(websocket, ErrorCode.INVALID_REQUEST, "首帧必须是 JSON start 帧")
        await websocket.close(code=4400)
        return

    if start.get("type") != "start":
        await _send_error(websocket, ErrorCode.INVALID_REQUEST, "缺少 start 帧")
        await websocket.close(code=4400)
        return

    token = start.get("token") or websocket.query_params.get("token")
    try:
        client = authenticate(settings, token)
        limiter.check(client.key_id)
    except AppError as exc:
        await _send_error(websocket, exc.code, exc.message)
        await websocket.close(code=4401)
        return

    session_id = str(start.get("sessionId") or f"ws-{id(websocket):x}")
    sample_rate = int(start.get("sampleRate") or 16000)
    if sample_rate <= 0 or sample_rate > 48000:
        await _send_error(websocket, ErrorCode.INVALID_REQUEST, "sampleRate 必须在 1~48000 之间")
        await websocket.close(code=4400)
        return

    # ---- 2. ASR 引擎就绪性检查（不静默降级） ----
    engine = services.asr_engine
    if not engine.available:
        await _send_error(
            websocket,
            ErrorCode.MODEL_UNAVAILABLE,
            engine.unavailable_reason() or f"ASR 引擎不可用: {engine.engine_id}",
        )
        await websocket.close(code=1011)
        return

    async def emit(payload: dict) -> None:
        await websocket.send_json(payload)

    session = AsrStreamSession(
        settings=settings,
        services=services,
        session_id=session_id,
        sample_rate=sample_rate,
        source_language=start.get("sourceLanguage"),
        target_language=start.get("targetLanguage"),
        emit=emit,
    )
    await websocket.send_json({"type": "started", "sessionId": session_id})

    # ---- 3. 音频帧循环 ----
    received_seconds = 0.0
    try:
        while True:
            message = await websocket.receive()
            if message.get("bytes") is not None:
                chunk: bytes = message["bytes"]
                if len(chunk) % 2 != 0:
                    chunk = chunk[:-1]  # int16 对齐保护
                received_seconds += len(chunk) / (sample_rate * 2.0)
                if received_seconds > _MAX_SESSION_SECONDS:
                    await _send_error(websocket, ErrorCode.INVALID_REQUEST, "会话超过最长时长限制")
                    break
                try:
                    await session.add_pcm(chunk)
                except AppError as exc:
                    await _send_error(websocket, exc.code, exc.message)
                    break
            elif message.get("text") is not None:
                try:
                    command = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                if command.get("type") == "stop":
                    break
    except WebSocketDisconnect:
        logger.info("ASR 会话被客户端断开: %s", session_id)
    finally:
        try:
            await session.finish()
        except Exception as exc:  # noqa: BLE001
            logger.warning("ASR 会话收尾失败 %s: %s", session_id, exc)
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001 - 已断开时忽略
            pass


async def _send_error(websocket: WebSocket, code: ErrorCode, message: str) -> None:
    try:
        await websocket.send_json({"type": "error", "error": {"code": code.value, "message": message}})
    except Exception:  # noqa: BLE001
        pass
