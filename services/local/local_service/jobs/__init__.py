"""长任务管理包。"""

from .base import JobHandler
from .handlers import (
    BatchTranslationJobHandler,
    DocumentOcrJobHandler,
    FileTranslationJobHandler,
    FileTranslationJobInput,
    FileTranslationJobResult,
    VideoAsrJobHandler,
    build_handlers,
)
from .manager import JobContext, JobManager, JobRecord

__all__ = [
    "JobManager",
    "JobRecord",
    "JobContext",
    "JobHandler",
    "DocumentOcrJobHandler",
    "VideoAsrJobHandler",
    "FileTranslationJobHandler",
    "FileTranslationJobInput",
    "FileTranslationJobResult",
    "BatchTranslationJobHandler",
    "build_handlers",
]
