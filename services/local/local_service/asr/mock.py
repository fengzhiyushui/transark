"""确定性 ASR 引擎（测试 / 离线演示用）。

- 输入 WAV 音频的真实时长从 WAV 头部读取（用于 durationSec）；
- 字幕 cue 文本来自内置脚本表（与 packages/contracts/src/mock.ts 的 ASR mock 对齐）；
- 时间戳按音频时长等比缩放，保证 cue 序列始终符合 AsrCue 契约。
"""

from __future__ import annotations

from ..models import AsrCue, AsrRequest, AsrResponse
from .base import AsrEngine, decode_audio, wav_duration_seconds

_SCRIPTED_CUES: list[dict] = [
    {"text": "Welcome to the bilingual browser translation tutorial.", "confidence": 0.98},
    {"text": "In this session, we demonstrate real-time offline speech recognition.", "confidence": 0.95},
    {"text": "Timestamps and audio cues remain aligned throughout media playback.", "confidence": 0.93},
]

# 契约 mock 中的 cue 时间轴（秒）
_SCRIPTED_TIMINGS: list[tuple[float, float]] = [(0.0, 2.85), (3.1, 6.4), (6.75, 10.2)]


class MockAsrEngine(AsrEngine):
    """确定性 ASR 引擎（本地、无外部依赖、无网络请求）。"""

    def __init__(
        self,
        scripted_cues: list[dict] | None = None,
        timings: list[tuple[float, float]] | None = None,
    ) -> None:
        self._cues = scripted_cues if scripted_cues is not None else _SCRIPTED_CUES
        self._timings = timings if timings is not None else _SCRIPTED_TIMINGS

    @property
    def engine_id(self) -> str:
        return "mock/deterministic-asr"

    async def transcribe(self, request: AsrRequest) -> AsrResponse:
        duration: float | None = None
        if request.audio_data:
            payload, _mime = decode_audio(request.audio_data)
            duration = wav_duration_seconds(payload)
        if duration is None:
            duration = self._timings[-1][1] if self._timings else 0.0

        cues: list[AsrCue] = []
        count = min(len(self._cues), len(self._timings))
        if count == 0:
            return AsrResponse(requestId=request.request_id, cues=[], durationSec=duration)

        # 有真实音频时长时按比例缩放脚本时间轴；否则沿用脚本时间
        script_total = self._timings[count - 1][1] - self._timings[0][0]
        scale = (duration / script_total) if script_total > 0 and duration > 0 else 1.0
        offset = self._timings[0][0]
        for index in range(count):
            start, end = self._timings[index]
            cues.append(
                AsrCue(
                    id=f"cue-{index + 1:03d}",
                    startTime=round(offset + (start - offset) * scale, 3),
                    endTime=round(offset + (end - offset) * scale, 3),
                    text=self._cues[index]["text"],
                    confidence=self._cues[index].get("confidence"),
                    speaker="speaker_1",
                )
            )
        return AsrResponse(
            requestId=request.request_id,
            cues=cues,
            detectedLanguage="en",
            durationSec=round(duration, 3),
        )
