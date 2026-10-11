"""长任务契约模型（与 packages/contracts/src/job.ts 对齐）。"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any

from pydantic import Field

from .base import ContractModel
from .error import ErrorCode


class JobStatus(str, Enum):
    """统一长任务状态常量（与 TS ``JobStatus`` 一致）。"""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


def is_job_terminal(status: JobStatus | str) -> bool:
    return status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED)


def is_job_active(status: JobStatus | str) -> bool:
    return status in (JobStatus.PENDING, JobStatus.PROCESSING)


class JobType:
    """长任务业务类型常量。"""

    FILE_TRANSLATION = "file-translation"
    VIDEO_ASR = "video-asr"
    DOCUMENT_OCR = "document-ocr"
    BATCH_TRANSLATION = "batch-translation"


class JobErrorInfo(ContractModel):
    """任务错误结构。"""

    code: ErrorCode
    message: str


class JobProgressEvent(ContractModel):
    """统一长任务进度事件（轮询 / SSE 通用）。"""

    job_id: str
    status: JobStatus
    progress: float = Field(ge=0.0, le=100.0, description="百分比进度 0~100")
    stage: str | None = None
    message: str | None = None
    processed_items: int | None = Field(default=None, ge=0)
    total_items: int | None = Field(default=None, ge=0)
    error: JobErrorInfo | None = None
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class JobDescriptor(ContractModel):
    """统一长任务描述符实体。

    TS 契约为泛型 ``JobDescriptor<TInput, TResult>``；Python 侧 input/result
    以字典承载（由各 JobHandler 声明的 Pydantic 模型严格校验后按契约字段转储）。
    """

    id: str = Field(description="任务唯一标识")
    type: str = Field(description="任务业务类型")
    status: JobStatus
    created_at: int
    updated_at: int
    input: dict[str, Any] | None = None
    progress: JobProgressEvent | None = None
    result: dict[str, Any] | None = None
    error: JobErrorInfo | None = None


class JobCreateRequest(ContractModel):
    """创建长任务请求。"""

    type: str = Field(description="任务类型：file-translation / video-asr / document-ocr / batch-translation")
    input: dict[str, Any] = Field(description="任务输入参数（按类型由对应模型校验）")
    request_id: str | None = Field(default=None, description="可选请求追踪 ID")
    session_id: str | None = Field(default=None, description="业务会话 ID（同会话高代次任务会自动取消低代次任务）")
    session_generation: int | None = Field(default=None, ge=0, description="会话代次号")


class JobListResponse(ContractModel):
    """长任务列表响应。"""

    jobs: list[JobDescriptor]
    total: int = Field(ge=0)
