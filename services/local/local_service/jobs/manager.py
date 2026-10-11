"""长任务管理器：创建 / 查询 / 取消 / SSE 订阅。

- 每个任务一个 :class:`JobRecord`（契约 JobDescriptor + 运行时句柄）；
- 执行体为 asyncio 任务，受 ``max_concurrent_jobs`` 信号量控制；
- 取消为协作式：先置取消事件并等待 ``job_cancel_grace_seconds``，
  超时后强制 cancel asyncio 任务；
- 同一 sessionId 的高代次任务创建时，自动取消同会话的低代次活跃任务
  （对应契约的 sessionId / sessionGeneration 语义）。
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import AsyncIterator

from ..models import (
    AppError,
    ErrorCode,
    JobDescriptor,
    JobErrorInfo,
    JobProgressEvent,
    JobStatus,
    is_job_terminal,
)
from ..models.job import JobCreateRequest
from .base import JobHandler

logger = logging.getLogger("local_service.jobs")


def _now_ms() -> int:
    return int(time.time() * 1000)


class JobContext:
    """任务执行上下文：进度上报、取消检查。"""

    def __init__(self, record: "JobRecord") -> None:
        self._record = record

    @property
    def job_id(self) -> str:
        return self._record.descriptor.id

    @property
    def cancel_event(self) -> asyncio.Event:
        return self._record.cancel_event

    @property
    def cancelled(self) -> bool:
        return self._record.cancel_event.is_set() or self._record.status in (
            JobStatus.CANCELLED,
            JobStatus.FAILED,
            JobStatus.COMPLETED,
        )

    def progress(
        self,
        progress: float,
        *,
        stage: str | None = None,
        message: str | None = None,
        processed_items: int | None = None,
        total_items: int | None = None,
    ) -> None:
        self._record.update_progress(
            progress=progress,
            stage=stage,
            message=message,
            processed_items=processed_items,
            total_items=total_items,
        )

    def raise_if_cancelled(self) -> None:
        if self.cancelled:
            raise asyncio.CancelledError

    async def sleep(self, seconds: float) -> None:
        """可取消的 sleep。"""
        try:
            await asyncio.wait_for(self.cancel_event.wait(), timeout=seconds)
        except (asyncio.TimeoutError, TimeoutError):
            return
        raise asyncio.CancelledError


class JobRecord:
    """任务运行时记录。"""

    def __init__(self, *, job_id: str, job_type: str, input_payload: dict) -> None:
        now = _now_ms()
        self.descriptor = JobDescriptor(
            id=job_id,
            type=job_type,
            status=JobStatus.PENDING,
            createdAt=now,
            updatedAt=now,
            input=input_payload,
        )
        self.cancel_event = asyncio.Event()
        self.task: asyncio.Task | None = None
        self.subscribers: list[asyncio.Queue[JobProgressEvent | None]] = []
        self.history: list[JobProgressEvent] = []

    # ------------------------------------------------------------ status
    @property
    def status(self) -> JobStatus:
        return self.descriptor.status

    def _touch(self) -> None:
        self.descriptor.updated_at = _now_ms()

    def _emit(self, event: JobProgressEvent) -> None:
        self.history.append(event)
        for queue in list(self.subscribers):
            if not queue.full():
                queue.put_nowait(event)

    def update_progress(
        self,
        *,
        progress: float,
        stage: str | None = None,
        message: str | None = None,
        processed_items: int | None = None,
        total_items: int | None = None,
    ) -> None:
        if is_job_terminal(self.status):
            return
        if self.status == JobStatus.PENDING:
            self.descriptor.status = JobStatus.PROCESSING
        event = JobProgressEvent(
            jobId=self.descriptor.id,
            status=self.descriptor.status,
            progress=max(0.0, min(100.0, progress)),
            stage=stage,
            message=message,
            processedItems=processed_items,
            totalItems=total_items,
            timestamp=_now_ms(),
        )
        self.descriptor.progress = event
        self._touch()
        self._emit(event)

    def mark_running(self) -> None:
        if self.status == JobStatus.PENDING:
            self.descriptor.status = JobStatus.PROCESSING
            self._touch()

    def mark_completed(self, result: dict) -> None:
        self.descriptor.status = JobStatus.COMPLETED
        self.descriptor.result = result
        self.descriptor.error = None
        event = JobProgressEvent(
            jobId=self.descriptor.id,
            status=JobStatus.COMPLETED,
            progress=100.0,
            stage="completed",
            message="任务完成",
            timestamp=_now_ms(),
        )
        self.descriptor.progress = event
        self._touch()
        self._emit(event)
        self._close_subscribers()

    def mark_failed(self, code: ErrorCode, message: str) -> None:
        self.descriptor.status = JobStatus.FAILED
        self.descriptor.error = JobErrorInfo(code=code, message=message)
        progress = self.descriptor.progress.progress if self.descriptor.progress else 0.0
        event = JobProgressEvent(
            jobId=self.descriptor.id,
            status=JobStatus.FAILED,
            progress=progress,
            stage=self.descriptor.progress.stage if self.descriptor.progress else None,
            message=message,
            error=self.descriptor.error,
            timestamp=_now_ms(),
        )
        self.descriptor.progress = event
        self._touch()
        self._emit(event)
        self._close_subscribers()

    def mark_cancelled(self) -> None:
        if is_job_terminal(self.status):
            return
        self.descriptor.status = JobStatus.CANCELLED
        if self.descriptor.error is None:
            self.descriptor.error = JobErrorInfo(
                code=ErrorCode.CANCELLED, message="任务已被用户取消"
            )
        progress = self.descriptor.progress.progress if self.descriptor.progress else 0.0
        event = JobProgressEvent(
            jobId=self.descriptor.id,
            status=JobStatus.CANCELLED,
            progress=progress,
            message="任务已取消",
            timestamp=_now_ms(),
        )
        self.descriptor.progress = event
        self._touch()
        self._emit(event)
        self._close_subscribers()

    # ------------------------------------------------------------ subscribers
    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self.subscribers.append(queue)
        # 先补发历史事件，保证 SSE 订阅不断档
        for event in self.history[-32:]:
            if not queue.full():
                queue.put_nowait(event)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self.subscribers:
            self.subscribers.remove(queue)

    def _close_subscribers(self) -> None:
        for queue in list(self.subscribers):
            if not queue.full():
                queue.put_nowait(None)


class JobManager:
    """长任务管理器。"""

    def __init__(
        self,
        handlers: dict[str, JobHandler],
        *,
        max_concurrent_jobs: int = 2,
        cancel_grace_seconds: float = 2.0,
    ) -> None:
        self._handlers = handlers
        self._records: dict[str, JobRecord] = {}
        self._semaphore = asyncio.Semaphore(max_concurrent_jobs)
        self._cancel_grace = cancel_grace_seconds
        self._counter = 0

    # -------------------------------------------------------------- handlers
    @property
    def supported_types(self) -> list[str]:
        return sorted(self._handlers)

    def handler_for(self, job_type: str) -> JobHandler:
        handler = self._handlers.get(job_type)
        if handler is None:
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                f"不支持的任务类型: {job_type!r}",
                {"supported": self.supported_types},
            )
        return handler

    # ----------------------------------------------------------------- create
    async def create(self, request: JobCreateRequest) -> JobRecord:
        handler = self.handler_for(request.type)

        # 同会话高代次任务取消低代次活跃任务
        if request.session_id is not None:
            for record in self._records.values():
                if (
                    record.descriptor.type == request.type
                    and record.descriptor.input
                    and record.descriptor.input.get("sessionId") == request.session_id
                    and not is_job_terminal(record.status)
                ):
                    await self.cancel(record.descriptor.id)

        try:
            validated_input = handler.input_model.model_validate(request.input)
        except Exception as exc:  # noqa: BLE001 - pydantic ValidationError
            raise AppError(
                ErrorCode.INVALID_REQUEST,
                f"任务输入参数校验失败: {exc.error_count() if hasattr(exc, 'error_count') else '?'} 个错误",
                {
                    "type": request.type,
                    "errors": _format_validation_errors(exc),
                },
            ) from exc

        job_id = self._next_job_id()
        input_payload = validated_input.dump()
        if request.session_id is not None:
            input_payload["sessionId"] = request.session_id
        if request.session_generation is not None:
            input_payload["sessionGeneration"] = request.session_generation

        record = JobRecord(job_id=job_id, job_type=request.type, input_payload=input_payload)
        self._records[job_id] = record

        context = JobContext(record)
        record.task = asyncio.create_task(
            self._run(handler, validated_input, context, record),
            name=f"job-{job_id}",
        )
        return record

    def _next_job_id(self) -> str:
        self._counter += 1
        stamp = time.strftime("%Y%m%d-%H%M%S")
        return f"job-{stamp}-{self._counter:04d}-{uuid.uuid4().hex[:6]}"

    # ------------------------------------------------------------------- run
    async def _run(self, handler: JobHandler, validated_input, context: JobContext, record: JobRecord) -> None:
        try:
            async with self._semaphore:
                if context.cancelled:
                    return
                record.mark_running()
                result = await handler.execute(validated_input, context)
                if context.cancelled:
                    record.mark_cancelled()
                    return
                record.mark_completed(result.dump() if hasattr(result, "dump") else dict(result))
        except asyncio.CancelledError:
            record.mark_cancelled()
            raise
        except AppError as exc:
            logger.warning("任务 %s 失败: %s (%s)", record.descriptor.id, exc.message, exc.code)
            record.mark_failed(exc.code, exc.message)
        except Exception as exc:  # noqa: BLE001
            logger.exception("任务 %s 内部错误", record.descriptor.id)
            record.mark_failed(ErrorCode.INTERNAL_ERROR, f"任务内部错误: {exc}")

    # ----------------------------------------------------------------- query
    def get(self, job_id: str) -> JobRecord:
        record = self._records.get(job_id)
        if record is None:
            raise AppError(
                ErrorCode.RESOURCE_NOT_FOUND,
                f"任务不存在: {job_id}",
                {"jobId": job_id},
            )
        return record

    def list(
        self,
        *,
        status: JobStatus | str | None = None,
        job_type: str | None = None,
        limit: int = 50,
    ) -> list[JobRecord]:
        records = list(self._records.values())
        if status is not None:
            wanted = status.value if isinstance(status, JobStatus) else str(status)
            records = [r for r in records if r.status.value == wanted]
        if job_type is not None:
            records = [r for r in records if r.descriptor.type == job_type]
        records.sort(key=lambda r: r.descriptor.created_at, reverse=True)
        return records[: max(1, limit)]

    # ---------------------------------------------------------------- cancel
    async def cancel(self, job_id: str) -> JobRecord:
        record = self.get(job_id)
        if is_job_terminal(record.status):
            return record
        record.cancel_event.set()
        if record.task is not None and not record.task.done():
            try:
                await asyncio.wait_for(asyncio.shield(record.task), timeout=self._cancel_grace)
            except (asyncio.TimeoutError, TimeoutError):
                record.task.cancel()
            except asyncio.CancelledError:
                pass
            except Exception:  # noqa: BLE001 - 取消过程中的异常不掩盖取消结果
                logger.exception("取消任务 %s 时出现异常", job_id)
        if not is_job_terminal(record.status):
            record.mark_cancelled()
        return record

    # ------------------------------------------------------------------- SSE
    async def event_stream(self, job_id: str) -> AsyncIterator[str]:
        """SSE 进度事件流（终态后自动结束）。"""
        record = self.get(job_id)
        queue = record.subscribe()
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield _format_sse(event)
                if is_job_terminal(event.status):
                    break
        finally:
            record.unsubscribe(queue)

    # -------------------------------------------------------------- lifecycle
    async def shutdown(self) -> None:
        for record in self._records.values():
            if record.task is not None and not record.task.done():
                record.cancel_event.set()
                record.task.cancel()
        pending = [r.task for r in self._records.values() if r.task is not None and not r.task.done()]
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    @property
    def active_count(self) -> int:
        return sum(1 for r in self._records.values() if r.status in (JobStatus.PENDING, JobStatus.PROCESSING))


def _format_sse(event: JobProgressEvent) -> str:
    return f"event: progress\ndata: {event.dump_json()}\n\n"


def _format_validation_errors(exc: Exception) -> list[dict]:
    try:
        return [
            {
                "loc": [str(part) for part in error.get("loc", [])],
                "message": error.get("msg", ""),
                "type": error.get("type", ""),
            }
            for error in exc.errors()  # type: ignore[attr-defined]
        ]
    except Exception:  # noqa: BLE001  # pragma: no cover
        return [{"message": str(exc)}]
