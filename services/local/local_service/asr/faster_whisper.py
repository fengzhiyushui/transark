"""faster-whisper 适配器（本地 CTranslate2 推理，规划接入）。"""

from __future__ import annotations

from ..models import AppError, AsrRequest, AsrResponse, ErrorCode
from .base import AsrEngine, decode_audio, wav_duration_seconds


class FasterWhisperEngine(AsrEngine):
    """faster-whisper 本地推理适配器。"""

    def __init__(self, model_id: str = "medium", device: str = "cpu") -> None:
        self._model_id = model_id
        self._device = device
        self._model = None
        self._load_error: str | None = None

    @property
    def engine_id(self) -> str:
        return f"faster-whisper/{self._model_id}"

    @property
    def available(self) -> bool:
        if self._load_error:
            return False
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return False
        return True

    def unavailable_reason(self) -> str | None:
        if self._load_error:
            return self._load_error
        return "未安装 faster-whisper：请执行 pip install faster-whisper（本地推理，无网络请求）"

    def _ensure_model(self):
        if self._model is not None:
            return self._model
        try:
            from faster_whisper import WhisperModel  # type: ignore

            self._model = WhisperModel(self._model_id, device=self._device)
        except ImportError as exc:
            self._load_error = f"未安装 faster-whisper: {exc}"
            raise AppError(
                ErrorCode.OFFLINE_REQUIRED,
                self._load_error,
                {"engine": self.engine_id},
            ) from exc
        except Exception as exc:  # noqa: BLE001 - 模型下载/加载失败
            raise AppError(
                ErrorCode.MODEL_UNAVAILABLE,
                f"faster-whisper 模型加载失败: {exc}",
                {"engine": self.engine_id},
            ) from exc
        return self._model

    async def transcribe(self, request: AsrRequest) -> AsrResponse:
        self.ensure_available()
        if not request.audio_data:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                "faster-whisper 适配器需要 audioData（Base64 音频）",
            )

        payload, _mime = decode_audio(request.audio_data)
        duration = wav_duration_seconds(payload)

        import asyncio
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory(prefix="local-asr-") as tmp:
            audio_path = Path(tmp) / "chunk.wav"
            audio_path.write_bytes(payload)

            def _run():
                model = self._ensure_model()
                segments, _info = model.transcribe(
                    str(audio_path),
                    language=request.source_language,
                    vad_filter=True,
                )
                return list(segments)

            segments = await asyncio.to_thread(_run)

        from ..models import AsrCue

        cues = [
            AsrCue(
                id=f"cue-{index + 1:03d}",
                startTime=round(float(segment.start), 3),
                endTime=round(float(segment.end), 3),
                text=segment.text.strip(),
                confidence=round(float(getattr(segment, "avg_logprob", 0.0) or 0.0), 4)
                if getattr(segment, "avg_logprob", None) is not None
                else None,
            )
            for index, segment in enumerate(segments)
            if segment.text.strip()
        ]
        return AsrResponse(
            requestId=request.request_id,
            cues=cues,
            detectedLanguage=request.source_language,
            durationSec=duration,
        )
