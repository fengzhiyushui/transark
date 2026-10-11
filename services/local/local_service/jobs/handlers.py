"""长任务处理器：OCR / ASR / 文件翻译 / 批量翻译。"""

from __future__ import annotations

import logging

from pydantic import Field, field_validator

from ..documents import DocumentService
from ..documents.exporters import encode_base64, export_document
from ..documents.models import (
    DocumentExportRequest,
    DocumentExportResponse,
    DocumentParseRequest,
    ExportFormat,
    ExportLayout,
    ExportUnit,
)
from ..models import (
    AppError,
    AsrRequest,
    AsrResponse,
    ErrorCode,
    OcrRequest,
    OcrResponse,
    TranslationRequest,
    TranslationResponse,
)
from ..models.base import ContractModel, ensure_base64_payload
from ..recognition import resolve_asr_engine, resolve_ocr_engine
from ..translation_service import TranslationService
from .base import JobHandler
from .manager import JobContext

logger = logging.getLogger("local_service.jobs.handlers")


# ---------------------------------------------------------------- 输入/结果模型
class FileTranslationJobInput(ContractModel):
    """文件翻译任务输入。"""

    filename: str | None = None
    mime_type: str | None = None
    data: str = Field(description="Base64 文件内容")
    source_language: str = "auto"
    target_language: str = "zh-CN"
    profile_id: str | None = None
    export_format: ExportFormat = "markdown"
    export_layout: ExportLayout = "bilingual"
    title: str | None = None

    @field_validator("data")
    @classmethod
    def _validate_data(cls, value: str) -> str:
        return ensure_base64_payload(value, field="data")


class FileTranslationJobResult(ContractModel):
    """文件翻译任务结果。"""

    translation: TranslationResponse
    export: DocumentExportResponse
    unit_count: int = 0
    format: str = "unknown"


# ---------------------------------------------------------------- OCR 任务
class DocumentOcrJobHandler(JobHandler):
    """OCR 长任务：图片/扫描页 → OcrBlock 列表。"""

    type = "document-ocr"

    def __init__(self, settings) -> None:
        self._settings = settings

    @property
    def input_model(self) -> type[ContractModel]:
        return OcrRequest

    @property
    def result_model(self) -> type[ContractModel]:
        return OcrResponse

    async def execute(self, input_data: OcrRequest, context: JobContext) -> OcrResponse:
        context.progress(5, stage="loading", message="加载 OCR 引擎")
        engine = resolve_ocr_engine(self._settings)
        engine.ensure_available()
        context.progress(25, stage="preprocessing", message="预处理图像")
        response = await engine.recognize(input_data)
        context.progress(
            90,
            stage="recognizing",
            message=f"识别完成，共 {len(response.blocks)} 个文字块",
            processed_items=len(response.blocks),
            total_items=len(response.blocks),
        )
        return response


# ---------------------------------------------------------------- ASR 任务
class VideoAsrJobHandler(JobHandler):
    """ASR 长任务：分块音频 → 带时间戳的 AsrCue 序列。"""

    type = "video-asr"

    def __init__(self, settings) -> None:
        self._settings = settings

    @property
    def input_model(self) -> type[ContractModel]:
        return AsrRequest

    @property
    def result_model(self) -> type[ContractModel]:
        return AsrResponse

    async def execute(self, input_data: AsrRequest, context: JobContext) -> AsrResponse:
        context.progress(5, stage="loading", message="加载 ASR 引擎")
        engine = resolve_asr_engine(self._settings)
        engine.ensure_available()
        context.progress(30, stage="decoding", message="解码音频分块")
        response = await engine.transcribe(input_data)
        context.progress(
            90,
            stage="transcribing",
            message=f"识别完成，共 {len(response.cues)} 条字幕",
            processed_items=len(response.cues),
            total_items=len(response.cues),
        )
        return response


# ---------------------------------------------------------------- 文件翻译任务
class FileTranslationJobHandler(JobHandler):
    """文件翻译长任务：解析 → 翻译 → 导出。"""

    type = "file-translation"

    def __init__(self, settings, documents: DocumentService, translation: TranslationService) -> None:
        self._settings = settings
        self._documents = documents
        self._translation = translation

    @property
    def input_model(self) -> type[ContractModel]:
        return FileTranslationJobInput

    @property
    def result_model(self) -> type[ContractModel]:
        return FileTranslationJobResult

    async def execute(self, input_data: FileTranslationJobInput, context: JobContext) -> FileTranslationJobResult:
        # 1) 解析
        context.progress(5, stage="parsing", message="解析文档结构")
        parse_request = DocumentParseRequest(
            requestId=context.job_id,
            filename=input_data.filename,
            mimeType=input_data.mime_type,
            data=input_data.data,
            sourceLanguage=None if input_data.source_language == "auto" else input_data.source_language,
        )
        parsed = await self._documents.parse(parse_request)
        if parsed.requires_ocr:
            raise_from_ocr_required(parsed.format)
        context.progress(
            25,
            stage="parsing",
            message=f"解析完成，共 {parsed.unit_count} 个单元",
            processed_items=parsed.unit_count,
            total_items=parsed.unit_count,
        )

        # 2) 翻译（仅可翻译单元）
        translatable = [unit for unit in parsed.units if unit.translatable and unit.text.strip()]
        total = len(translatable)
        processed = 0

        async def on_segment_done(_segment_id: str, _translation: str) -> None:
            nonlocal processed
            processed += 1
            if total:
                context.progress(
                    25 + int(60 * processed / total),
                    stage="translating",
                    message=f"已翻译 {processed}/{total} 个段落",
                    processed_items=processed,
                    total_items=total,
                )

        segments = [
            {"id": unit.id, "text": unit.text}
            for unit in translatable
        ]
        translation_request = TranslationRequest(
            requestId=context.job_id,
            sourceLanguage=input_data.source_language,
            targetLanguage=input_data.target_language,
            segments=segments,
            profileId=input_data.profile_id,
        )
        translation_response = await self._translation.translate(
            translation_request, on_segment_done=on_segment_done
        )
        context.progress(
            85,
            stage="translating",
            message="翻译完成",
            processed_items=total,
            total_items=total,
        )

        # 3) 导出
        context.progress(90, stage="exporting", message="重组双语文档")
        translations_by_id = {item.id: item for item in translation_response.segments}
        export_units = [
            ExportUnit(
                id=unit.id,
                text=unit.text,
                translation=(
                    translations_by_id[unit.id].translation
                    if unit.id in translations_by_id
                    and translations_by_id[unit.id].error is None
                    else None
                ),
                kind=unit.kind,
                level=unit.level,
                tableId=unit.table_id,
                rowIndex=unit.row_index,
                columnIndex=unit.column_index,
            )
            for unit in parsed.units
        ]
        export_request = DocumentExportRequest(
            requestId=context.job_id,
            format=input_data.export_format,
            title=input_data.title or parsed.title,
            layout=input_data.export_layout,
            units=export_units,
        )
        content, fmt, mime_type, filename = export_document(export_request)
        export_response = DocumentExportResponse(
            requestId=context.job_id,
            filename=filename,
            mimeType=mime_type,
            data=encode_base64(content),
            sizeBytes=len(content),
            unitCount=len(export_units),
            format=fmt,
        )

        return FileTranslationJobResult(
            translation=translation_response,
            export=export_response,
            unitCount=len(parsed.units),
            format=parsed.format,
        )


def raise_from_ocr_required(fmt: str):
    """无文本层的扫描件：明确要求改用 OCR 长任务，而不是静默跳过。"""
    raise AppError(
        ErrorCode.INVALID_REQUEST,
        f"{fmt} 文档未检测到文本层（扫描件），请改用 document-ocr 长任务",
        {"format": fmt},
    )


# ---------------------------------------------------------------- 批量翻译任务
class BatchTranslationJobHandler(JobHandler):
    """批量翻译长任务：与同步 /v1/translate 同一契约，带进度与取消。"""

    type = "batch-translation"

    def __init__(self, translation: TranslationService) -> None:
        self._translation = translation

    @property
    def input_model(self) -> type[ContractModel]:
        return TranslationRequest

    @property
    def result_model(self) -> type[ContractModel]:
        return TranslationResponse

    async def execute(self, input_data: TranslationRequest, context: JobContext) -> TranslationResponse:
        total = len(input_data.segments)
        processed = 0

        async def on_segment_done(_segment_id: str, _translation: str) -> None:
            nonlocal processed
            processed += 1
            context.progress(
                int(100 * processed / total) if total else 100,
                stage="translating",
                message=f"已翻译 {processed}/{total} 个段落",
                processed_items=processed,
                total_items=total,
            )
            context.raise_if_cancelled()

        context.progress(0, stage="queued", message="开始批量翻译", total_items=total)
        return await self._translation.translate(input_data, on_segment_done=on_segment_done)


def build_handlers(*, settings, documents: DocumentService, translation: TranslationService) -> dict[str, JobHandler]:
    """构造全部任务处理器。"""
    handlers: list[JobHandler] = [
        DocumentOcrJobHandler(settings),
        VideoAsrJobHandler(settings),
        FileTranslationJobHandler(settings, documents, translation),
        BatchTranslationJobHandler(translation),
    ]
    return {handler.type: handler for handler in handlers}
