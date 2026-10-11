"""OCR / ASR 引擎选择（按 settings 配置解析，缺失时给出明确错误）。"""

from __future__ import annotations

from .asr import AsrEngine, FasterWhisperEngine, MockAsrEngine, WhisperCppEngine
from .ocr import MockOcrEngine, OcrEngine, TesseractOcrEngine
from .settings import Settings


def resolve_ocr_engine(settings: Settings) -> OcrEngine:
    """解析 OCR 引擎。

    - ``tesseract``：强制本地 tesseract（缺失即报错）；
    - ``mock``：确定性引擎（测试 / 演示）；
    - ``auto``：优先 tesseract，缺失时回退确定性引擎并保持能力可解释。
    """
    choice = settings.ocr_engine
    if choice == "mock":
        return MockOcrEngine()
    tesseract = TesseractOcrEngine(binary=settings.tesseract_binary)
    if choice == "tesseract":
        return tesseract
    # auto
    if tesseract.available:
        return tesseract
    return MockOcrEngine()


def resolve_asr_engine(settings: Settings) -> AsrEngine:
    """解析 ASR 引擎。

    - ``whisper-cpp`` / ``faster-whisper``：本地推理（缺失即报错）；
    - ``mock``：确定性引擎（测试 / 演示）；
    - ``auto``：优先 whisper.cpp，其次 faster-whisper，最后确定性引擎。
    """
    choice = settings.asr_engine
    if choice == "mock":
        return MockAsrEngine()

    whisper_cpp = WhisperCppEngine(
        binary=settings.whisper_binary, model_path=settings.asr_model_path
    )
    if choice == "whisper-cpp":
        return whisper_cpp

    faster = FasterWhisperEngine(model_id=settings.asr_model_id)
    if choice == "faster-whisper":
        return faster

    # auto
    if whisper_cpp.available:
        return whisper_cpp
    if faster.available:
        return faster
    return MockAsrEngine()
