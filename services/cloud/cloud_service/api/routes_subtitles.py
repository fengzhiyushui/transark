"""字幕端点：提取（文件/URL）与翻译（批量 / SSE 逐 cue 流式）。

翻译语义与 ``POST /v1/translate`` 完全一致（同一契约与严格对齐校验），
``?stream=true`` 时按 SSE 逐段下发，实现「首 cue 即显示」：

    data: {"requestId":"...","type":"start"}
    data: {"requestId":"...","type":"segment","segment":{"id":"cue-1","translation":"..."}}
    data: {"requestId":"...","type":"done","response":{...完整 TranslationResponse...}}
    data: [DONE]

中途失败时下发 ``type=error`` 事件（携带契约错误码），随后以 [DONE] 结束；
已成功下发的段落不回滚，客户端按 id 归并即可。
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from local_service.api.deps import get_services
from local_service.models import (
    AppError,
    ErrorCode,
    TranslationRequest,
)
from local_service.models.base import ContractModel
from local_service.state import AppServices

from ..auth import CloudClient, require_cloud_client

logger = logging.getLogger("cloud_service.subtitles")

router = APIRouter(prefix="/v1/subtitles", tags=["subtitles"])

_MAX_SUBTITLE_BYTES = 20 * 1024 * 1024  # 字幕文件 20MB 上限


class SubtitleCueOut(ContractModel):
    """字幕 cue 输出单元（与契约 AsrCue 时间轴字段对齐）。"""

    id: str
    start_time: float
    end_time: float
    text: str


class SubtitleExtractRequest(ContractModel):
    """字幕提取请求：三选一（Base64 文件 / 字幕文本 / 公网 URL）。"""

    request_id: str
    filename: str | None = None
    data: str | None = None
    text: str | None = None
    url: str | None = None


class SubtitleExtractResponse(ContractModel):
    """字幕提取响应。"""

    request_id: str
    source: str
    cues: list[SubtitleCueOut]
    warnings: list[str] = []


@router.post(
    "/extract",
    response_model=SubtitleExtractResponse,
    response_model_exclude_none=True,
    summary="字幕提取",
    description="解析 SRT/VTT 字幕为带时间轴的 cue 列表；支持 Base64 文件、纯文本或公网 URL。",
)
async def extract_subtitles(
    request: SubtitleExtractRequest,
    services: AppServices = Depends(get_services),
    _client: CloudClient = Depends(require_cloud_client),
) -> SubtitleExtractResponse:
    raw_text: str | None = None
    source = "upload"

    if request.data:
        try:
            payload = base64.b64decode(request.data, validate=False)
        except (binascii.Error, ValueError) as exc:
            raise AppError(ErrorCode.INVALID_REQUEST, "data 不是合法的 Base64 内容") from exc
        if len(payload) > _MAX_SUBTITLE_BYTES:
            raise AppError(ErrorCode.INVALID_REQUEST, "字幕文件超过 20MB 上限")
        raw_text = payload.decode("utf-8", errors="replace")
    elif request.text:
        raw_text = request.text
        source = "text"
    elif request.url:
        source = "url"
        raw_text = await _fetch_subtitle_url(services, request.url)
    else:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "必须提供 data（Base64 文件）、text（字幕文本）或 url（公网字幕地址）之一",
        )

    from local_service.documents.models import ParseOptions
    from local_service.documents.parsers import parse_subtitles

    units = parse_subtitles(raw_text, options=ParseOptions())
    cues = [
        SubtitleCueOut(
            id=unit.id,
            startTime=unit.start_time or 0.0,
            endTime=unit.end_time or 0.0,
            text=unit.text,
        )
        for unit in units
        if unit.kind == "subtitle-cue" and unit.end_time is not None
    ]
    if not cues:
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "未能从输入中解析出任何字幕 cue（支持 SRT / VTT 时间轴格式）",
        )
    return SubtitleExtractResponse(requestId=request.request_id, source=source, cues=cues)


async def _fetch_subtitle_url(services: AppServices, url: str) -> str:
    """抓取公网字幕 URL。

    SSRF 防护：拒绝回环、私有网段与 ``.local/.lan/.internal`` 域名；
    重定向逐跳重新校验（最多 3 跳），避免 302 绕过。
    """
    current = url
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=5.0), follow_redirects=False
    ) as client:
        for _hop in range(4):
            _assert_public_url(services, current)
            try:
                response = await client.get(current)
            except httpx.HTTPError as exc:
                raise AppError(
                    ErrorCode.NETWORK_ERROR,
                    f"字幕 URL 抓取失败: {exc}",
                    {"url": current},
                ) from exc
            if response.is_redirect and response.headers.get("location"):
                current = str(response.url.join(response.headers["location"]))
                continue
            try:
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise AppError(
                    ErrorCode.NETWORK_ERROR,
                    f"字幕 URL 抓取失败: {exc}",
                    {"url": current},
                ) from exc
            content = response.content
            if len(content) > _MAX_SUBTITLE_BYTES:
                raise AppError(ErrorCode.INVALID_REQUEST, "字幕内容超过 20MB 上限")
            return content.decode("utf-8", errors="replace")
    raise AppError(ErrorCode.INVALID_REQUEST, "字幕 URL 重定向次数过多")


def _assert_public_url(services: AppServices, url: str) -> None:
    from local_service.settings import is_loopback_host

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise AppError(ErrorCode.INVALID_REQUEST, "仅支持 http/https 字幕地址")
    host = (parsed.hostname or "").lower()
    if not host:
        raise AppError(ErrorCode.INVALID_REQUEST, "字幕 URL 缺少主机名")
    private_host = False
    try:
        import ipaddress

        private_host = ipaddress.ip_address(host).is_private
    except ValueError:
        private_host = host.endswith((".local", ".lan", ".internal"))
    if is_loopback_host(host) or private_host:
        raise AppError(
            ErrorCode.POLICY_VIOLATION,
            "拒绝抓取回环或私有网段地址（SSRF 防护）",
            {"url": url},
        )
    services.guard.check_url(url, "allow-cloud", purpose="字幕抓取")


@router.post(
    "/translate",
    summary="字幕翻译（批量 / SSE 流式）",
    description=(
        "契约与 /v1/translate 完全一致；stream=true 时按 SSE 逐段下发，"
        "每段一译出即推送，无需等待整批。"
    ),
)
async def translate_subtitles(
    request: TranslationRequest,
    stream: bool = Query(default=False),
    services: AppServices = Depends(get_services),
    _client: CloudClient = Depends(require_cloud_client),
) -> Any:
    if not stream:
        return await services.translation.translate(request)

    return StreamingResponse(
        _translate_event_stream(services, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _translate_event_stream(services: AppServices, request: TranslationRequest):
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def on_segment_done(segment_id: str, translation: str) -> None:
        await queue.put(
            {"type": "segment", "segment": {"id": segment_id, "translation": translation}}
        )

    async def run() -> None:
        try:
            response = await services.translation.translate(request, on_segment_done=on_segment_done)
            await queue.put(
                {
                    "type": "done",
                    "response": response.model_dump(by_alias=True, exclude_none=True, mode="json"),
                }
            )
        except AppError as exc:
            await queue.put({"type": "error", "error": exc.to_dict()})
        except Exception as exc:  # noqa: BLE001
            logger.exception("字幕流式翻译内部错误")
            await queue.put(
                {"type": "error", "error": {"code": ErrorCode.INTERNAL_ERROR.value, "message": str(exc)}}
            )
        finally:
            await queue.put(None)

    task = asyncio.create_task(run())
    try:
        yield _sse({"requestId": request.request_id, "type": "start"})
        while True:
            item = await queue.get()
            if item is None:
                break
            yield _sse({"requestId": request.request_id, **item})
    finally:
        if not task.done():
            task.cancel()
    yield "data: [DONE]\n\n"


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
