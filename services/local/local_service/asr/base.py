"""ASR 引擎抽象。

规划接入 whisper.cpp / faster-whisper；两者均未就绪时返回明确的
MODEL_UNAVAILABLE / OFFLINE_REQUIRED 错误，绝不静默改用云端识别。
音频数据始终留在本机（子进程 / 本地库推理），不经过网络出口。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import AppError, ErrorCode, AsrRequest, AsrResponse


class AsrEngine(ABC):
    """ASR 引擎统一接口：分块音频 → 带时间戳的 AsrCue 序列。"""

    @property
    @abstractmethod
    def engine_id(self) -> str:
        """引擎标识（如 'whisper-cpp/ggml-medium.bin'）。"""

    @property
    def is_local(self) -> bool:
        return True

    @property
    def available(self) -> bool:
        return True

    def unavailable_reason(self) -> str | None:
        return None

    @abstractmethod
    async def transcribe(self, request: AsrRequest) -> AsrResponse:
        """执行识别并返回符合契约的 AsrCue 序列。"""

    def ensure_available(self) -> None:
        if not self.available:
            raise AppError(
                ErrorCode.MODEL_UNAVAILABLE,
                self.unavailable_reason() or f"ASR 引擎不可用: {self.engine_id}",
                {"engine": self.engine_id},
            )


def decode_audio(audio_data: str) -> tuple[bytes, str | None]:
    """把 Base64 / data URI 音频数据解码为字节流。"""
    import base64
    import binascii
    import re

    mime_type: str | None = None
    text = audio_data.strip()
    if text.startswith("data:"):
        header, _, payload = text.partition(",")
        match = re.search(r"data:([^;]+);base64", header)
        if match:
            mime_type = match.group(1)
        text = payload
    try:
        return base64.b64decode(re.sub(r"\s+", "", text), validate=False), mime_type
    except (binascii.Error, ValueError) as exc:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "audioData 不是合法的 Base64 内容",
        ) from exc


def wav_duration_seconds(payload: bytes) -> float | None:
    """从 WAV 头部读取时长（秒）；非 WAV 返回 None。"""
    import io
    import wave

    try:
        with wave.open(io.BytesIO(payload), "rb") as reader:
            frames = reader.getnframes()
            rate = reader.getframerate()
            if rate <= 0:
                return None
            return frames / float(rate)
    except (wave.Error, EOFError, OSError):
        return None
