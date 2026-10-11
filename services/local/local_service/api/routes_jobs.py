"""长任务端点：创建 / 查询 / 列表 / 取消 / SSE 进度。"""

from __future__ import annotations

from fastapi import APIRouter, Query, status
from fastapi.responses import StreamingResponse

from ..models import JobCreateRequest, JobDescriptor, JobListResponse, JobStatus
from .deps import CurrentToken, Services

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])


@router.post(
    "",
    response_model=JobDescriptor,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
    summary="创建长任务",
    description=(
        "任务类型与 input 契约：\n"
        "- `document-ocr` → `OcrRequest`（结果 `OcrResponse`）\n"
        "- `video-asr` → `AsrRequest`（结果 `AsrResponse`）\n"
        "- `file-translation` → `FileTranslationJobInput`（结果 `FileTranslationJobResult`）\n"
        "- `batch-translation` → `TranslationRequest`（结果 `TranslationResponse`）\n"
        "input 按任务类型由对应 Pydantic 模型严格校验。"
    ),
)
async def create_job(
    request: JobCreateRequest,
    services: Services,
    _token: CurrentToken,
) -> JobDescriptor:
    record = await services.jobs.create(request)
    return record.descriptor


@router.get("", response_model=JobListResponse, response_model_exclude_none=True, summary="长任务列表")
async def list_jobs(
    services: Services,
    _token: CurrentToken,
    job_status: JobStatus | None = Query(default=None, alias="status"),
    job_type: str | None = Query(default=None, alias="type"),
    limit: int = Query(default=50, ge=1, le=200),
) -> JobListResponse:
    records = services.jobs.list(status=job_status, job_type=job_type, limit=limit)
    return JobListResponse(jobs=[r.descriptor for r in records], total=len(records))


@router.get(
    "/{job_id}",
    response_model=JobDescriptor,
    response_model_exclude_none=True,
    summary="查询长任务状态",
)
async def get_job(
    job_id: str,
    services: Services,
    _token: CurrentToken,
) -> JobDescriptor:
    return services.jobs.get(job_id).descriptor


@router.post(
    "/{job_id}/cancel",
    response_model=JobDescriptor,
    response_model_exclude_none=True,
    summary="取消长任务",
)
async def cancel_job(
    job_id: str,
    services: Services,
    _token: CurrentToken,
) -> JobDescriptor:
    record = await services.jobs.cancel(job_id)
    return record.descriptor


@router.get("/{job_id}/events", summary="长任务进度 SSE 流")
async def job_events(
    job_id: str,
    services: Services,
    _token: CurrentToken,
) -> StreamingResponse:
    services.jobs.get(job_id)  # 不存在时抛 404
    generator = services.jobs.event_stream(job_id)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
