"""流式 ASR 会话：PCM 分块 → whisper 转写 → 带时间戳的 cue 流。

客户端发送 16kHz 单声道 int16 PCM 二进制帧；服务端按
``asr_chunk_seconds`` 窗口转写，相邻窗口保留 ``asr_overlap_seconds``
重叠并按时间轴去重，保证 cue 衔接平滑。

可选地，若 ``start`` 帧声明了 ``targetLanguage``，每个 cue 识别完成后
会立即调用翻译服务并推送 ``translation`` 事件——浏览器端可以实现
「识别到一句话就显示译文」的体验。
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import wave
from typing import Any, Awaitable, Callable

from local_service.models import (
    AppError,
    AsrRequest,
    ErrorCode,
    TranslationRequest,
)

from .settings import CloudSettings

logger = logging.getLogger("cloud_service.asr_stream")

EmitCallback = Callable[[dict[str, Any]], Awaitable[None]]


def pcm16_to_wav(pcm: bytes, sample_rate: int = 16000) -> bytes:
    """把 int16 LE 单声道 PCM 包装为 WAV 字节流。"""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


class AsrStreamSession:
    """单条 WS 连接的 ASR 会话状态机。"""

    def __init__(
        self,
        *,
        settings: CloudSettings,
        services: Any,
        session_id: str,
        sample_rate: int,
        source_language: str | None,
        target_language: str | None,
        emit: EmitCallback,
    ) -> None:
        self._settings = settings
        self._services = services
        self._session_id = session_id
        self._sample_rate = sample_rate
        self._source_language = source_language
        self._target_language = target_language
        self._emit = emit

        self._buffer = bytearray()
        self._buffer_start = 0.0  # buffer 起点对应的会话时间（秒）
        self._emitted_until = 0.0  # 已下发 cue 覆盖到的会话时间
        self._cue_counter = 0
        self._generation = 0
        self._finished = False
        self._translation_tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------------ intake
    async def add_pcm(self, data: bytes) -> None:
        if self._finished:
            return
        self._buffer.extend(data)
        bytes_per_chunk = int(self._settings.asr_chunk_seconds * self._sample_rate * 2)
        while len(self._buffer) >= bytes_per_chunk:
            await self._flush_chunk(bytes_per_chunk, final=False)

    async def finish(self) -> None:
        if self._finished:
            return
        self._finished = True
        if len(self._buffer) >= int(0.3 * self._sample_rate * 2):
            await self._flush_chunk(len(self._buffer), final=True)
        # 等待尾部 cue 的内联翻译完成，避免客户端提前断开导致丢失译文
        if self._translation_tasks:
            done, pending = await asyncio.wait(
                list(self._translation_tasks), timeout=5.0
            )
            for task in pending:
                task.cancel()
            if done:
                await asyncio.gather(*done, return_exceptions=True)
        await self._emit(
            {
                "type": "final",
                "sessionId": self._session_id,
                "durationSec": round(self._buffer_start + self._buffer_duration(), 3),
            }
        )

    # ------------------------------------------------------------------ chunks
    def _buffer_duration(self) -> float:
        return len(self._buffer) / float(self._sample_rate * 2)

    async def _flush_chunk(self, nbytes: int, *, final: bool) -> None:
        chunk = bytes(self._buffer[:nbytes])
        chunk_duration = len(chunk) / float(self._sample_rate * 2)
        chunk_start = self._buffer_start

        wav = pcm16_to_wav(chunk, self._sample_rate)
        self._generation += 1
        request = AsrRequest(
            requestId=f"{self._session_id}-{self._generation}",
            audioData=base64.b64encode(wav).decode("ascii"),
            mediaSessionId=self._session_id,
            generation=self._generation,
            sampleRate=self._sample_rate,
            sourceLanguage=self._source_language,
        )
        response = await self._services.asr_engine.transcribe(request)

        new_end = chunk_start + (chunk_duration if final else chunk_duration - self._settings.asr_overlap_seconds)
        for cue in response.cues:
            start = chunk_start + cue.start_time
            end = chunk_start + cue.end_time
            # 重叠区去重：已被上一窗口覆盖的时间不再下发
            if end <= self._emitted_until:
                continue
            self._cue_counter += 1
            cue_id = f"cue-{self._cue_counter:04d}"
            cue_payload = {
                "id": cue_id,
                "startTime": round(max(start, self._emitted_until), 3),
                "endTime": round(end, 3),
                "text": cue.text,
                **({"confidence": cue.confidence} if cue.confidence is not None else {}),
            }
            await self._emit({"type": "cue", "sessionId": self._session_id, "cue": cue_payload})
            if self._target_language:
                task = asyncio.create_task(self._translate_cue(cue_id, cue.text))
                self._translation_tasks.add(task)
                task.add_done_callback(self._translation_tasks.discard)

        self._emitted_until = max(self._emitted_until, new_end)

        if not final:
            keep = int(self._settings.asr_overlap_seconds * self._sample_rate * 2)
            del self._buffer[: nbytes - keep]
            self._buffer_start += chunk_duration - self._settings.asr_overlap_seconds
        else:
            self._buffer.clear()
            self._buffer_start += chunk_duration

    # ---------------------------------------------------------------- translate
    async def _translate_cue(self, cue_id: str, text: str) -> None:
        try:
            response = await self._services.translation.translate(
                TranslationRequest(
                    requestId=f"{self._session_id}-tr-{cue_id}",
                    sourceLanguage=self._source_language or "auto",
                    targetLanguage=self._target_language or "zh-CN",
                    segments=[{"id": cue_id, "text": text}],
                )
            )
            segment = response.segments[0] if response.segments else None
            if segment and segment.error is None and segment.translation:
                await self._emit(
                    {
                        "type": "translation",
                        "sessionId": self._session_id,
                        "cueId": cue_id,
                        "translation": segment.translation,
                    }
                )
            elif segment and segment.error:
                await self._emit(
                    {
                        "type": "translation",
                        "sessionId": self._session_id,
                        "cueId": cue_id,
                        "error": segment.error.model_dump(by_alias=True),
                    }
                )
        except AppError as exc:
            await self._emit(
                {
                    "type": "translation",
                    "sessionId": self._session_id,
                    "cueId": cue_id,
                    "error": {"code": exc.code.value, "message": exc.message},
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("cue 内联翻译失败 %s: %s", cue_id, exc)
