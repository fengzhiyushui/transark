"""whisper.cpp 适配器（本地子进程推理，规划接入）。

通过 ``-oj``（JSON 输出）调用 whisper.cpp 可执行文件，解析其
``transcription`` 段（含 offsets，单位 10ms）为契约的 AsrCue。
音频写入临时文件后由子进程读取，全程不经过网络。
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from ..models import AppError, AsrRequest, AsrResponse, ErrorCode
from .base import AsrEngine, decode_audio, wav_duration_seconds


class WhisperCppEngine(AsrEngine):
    """whisper.cpp 子进程适配器。"""

    def __init__(self, binary: str | None, model_path: str | None) -> None:
        self._binary = binary
        self._model_path = model_path

    @property
    def engine_id(self) -> str:
        model = Path(self._model_path).name if self._model_path else "unconfigured"
        return f"whisper-cpp/{model}"

    @property
    def available(self) -> bool:
        if not self._model_path or not Path(self._model_path).exists():
            return False
        binary = self._binary or "whisper"
        return shutil.which(binary) is not None or Path(binary).exists()

    def unavailable_reason(self) -> str | None:
        if not self._model_path:
            return (
                "未配置 ASR 模型权重：请设置 LOCAL_SERVICE_ASR_MODEL_PATH "
                "（whisper.cpp ggml 模型文件）"
            )
        if not Path(self._model_path).exists():
            return f"ASR 模型权重不存在: {self._model_path}"
        return (
            "未找到 whisper.cpp 可执行文件：请安装 whisper.cpp "
            "（或通过 LOCAL_SERVICE_WHISPER_BINARY 指定路径）"
        )

    async def transcribe(self, request: AsrRequest) -> AsrResponse:
        self.ensure_available()
        if not request.audio_data:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                "whisper.cpp 适配器需要 audioData（Base64 音频）",
            )

        payload, _mime = decode_audio(request.audio_data)
        duration = wav_duration_seconds(payload)

        import asyncio

        with tempfile.TemporaryDirectory(prefix="local-asr-") as tmp:
            audio_path = Path(tmp) / "chunk.wav"
            audio_path.write_bytes(payload)
            command = [
                str(self._binary or "whisper"),
                "-m",
                str(self._model_path),
                "-f",
                str(audio_path),
                "-oj",  # JSON 输出
                "-np",  # 不打印进度
            ]
            if request.source_language:
                command += ["-l", request.source_language]

            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _stdout, stderr = await process.communicate()
            if process.returncode != 0:
                raise AppError(
                    ErrorCode.MODEL_UNAVAILABLE,
                    "whisper.cpp 识别失败",
                    {
                        "engine": self.engine_id,
                        "returncode": process.returncode,
                        "stderr": stderr.decode("utf-8", errors="replace")[:500],
                    },
                )

            json_path = audio_path.with_suffix(".wav.json")
            if not json_path.exists():
                raise AppError(
                    ErrorCode.MODEL_UNAVAILABLE,
                    "whisper.cpp 未生成 JSON 输出（请确认使用支持 -oj 的版本）",
                    {"engine": self.engine_id},
                )
            data = json.loads(json_path.read_text(encoding="utf-8"))

        cues = []
        for index, segment in enumerate(data.get("transcription", [])):
            text = str(segment.get("text", "")).strip()
            if not text:
                continue
            # whisper.cpp offsets 单位为 10 毫秒
            start = float(segment.get("offsets", {}).get("from", 0)) / 100.0
            end = float(segment.get("offsets", {}).get("to", 0)) / 100.0
            cues.append(
                {
                    "id": f"cue-{index + 1:03d}",
                    "startTime": start,
                    "endTime": end,
                    "text": text,
                }
            )

        from ..models import AsrCue

        return AsrResponse(
            requestId=request.request_id,
            cues=[AsrCue(**cue) for cue in cues],
            detectedLanguage=request.source_language,
            durationSec=duration,
        )
