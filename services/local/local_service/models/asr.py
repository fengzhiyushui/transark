"""ASR 契约模型（与 packages/contracts/src/asr.ts 对齐）。"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from .base import ContractModel, ensure_base64_payload


class AsrCue(ContractModel):
    """语音识别字幕时间轴单元 (Cue)。"""

    id: str = Field(description="字幕段唯一标识")
    start_time: float = Field(ge=0.0, description="开始时间（秒）")
    end_time: float = Field(gt=0.0, description="结束时间（秒）")
    text: str = Field(description="识别出的原文文本")
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    speaker: str | None = Field(default=None, description="说话人标识")


class AsrRequest(ContractModel):
    """语音识别请求。"""

    request_id: str
    audio_data: str | None = Field(default=None, description="Base64 音频数据或切片引用")
    media_session_id: str | None = Field(default=None, description="播放器媒体会话 ID")
    generation: int | None = Field(default=None, description="会话代次号")
    format: Literal["wav", "pcm", "webm", "mp3"] | None = Field(default=None, description="音频格式")
    sample_rate: int | None = Field(default=None, ge=1, description="采样率")
    source_language: str | None = Field(default=None, description="期望的源语言代码")

    @field_validator("audio_data")
    @classmethod
    def _validate_audio_data(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return ensure_base64_payload(value, field="audioData")


class AsrResponse(ContractModel):
    """语音识别响应。"""

    request_id: str
    cues: list[AsrCue]
    detected_language: str | None = None
    duration_sec: float | None = Field(default=None, ge=0.0, description="本段音频总时长（秒）")
