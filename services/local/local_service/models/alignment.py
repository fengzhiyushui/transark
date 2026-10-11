"""段落对齐校验（与 packages/contracts/src/alignment.ts 行为一致）。

规则（与 TS 版完全相同）：
1. requestId 必须匹配；
2. 响应段落 ID 不能重复；
3. 响应段落不得遗漏请求中的任何 ID；
4. 响应段落不得包含请求中未出现过的未知 ID。
"""

from __future__ import annotations

from typing import Literal

from .base import ContractModel
from .error import AppError, ErrorCode
from .translation import (
    TranslationRequest,
    TranslationResponse,
    TranslationSegmentResult,
)

AlignmentMismatchType = Literal[
    "DUPLICATE_REQUEST_ID",
    "DUPLICATE_RESPONSE_ID",
    "MISSING_SEGMENT",
    "EXTRA_SEGMENT",
    "REQUEST_ID_MISMATCH",
]


class AlignmentMismatchDetail(ContractModel):
    type: AlignmentMismatchType
    message: str
    segment_ids: list[str] | None = None


class TranslationAlignmentValidationResult(ContractModel):
    valid: bool
    errors: list[AlignmentMismatchDetail]


def validate_translation_alignment(
    request: TranslationRequest, response: TranslationResponse
) -> TranslationAlignmentValidationResult:
    """校验翻译请求与响应的段落 ID 是否严格对齐。"""
    errors: list[AlignmentMismatchDetail] = []

    if request.request_id != response.request_id:
        errors.append(
            AlignmentMismatchDetail(
                type="REQUEST_ID_MISMATCH",
                message=(
                    f'RequestId mismatch: expected "{request.request_id}", '
                    f'got "{response.request_id}"'
                ),
            )
        )

    req_id_set: set[str] = set()
    duplicate_req_ids: set[str] = set()
    for seg in request.segments:
        if seg.id in req_id_set:
            duplicate_req_ids.add(seg.id)
        req_id_set.add(seg.id)
    if duplicate_req_ids:
        errors.append(
            AlignmentMismatchDetail(
                type="DUPLICATE_REQUEST_ID",
                message="Request contains duplicate segment IDs: "
                + ", ".join(sorted(duplicate_req_ids)),
                segment_ids=sorted(duplicate_req_ids),
            )
        )

    resp_id_set: set[str] = set()
    duplicate_resp_ids: set[str] = set()
    extra_ids: set[str] = set()
    for seg in response.segments:
        if seg.id in resp_id_set:
            duplicate_resp_ids.add(seg.id)
        resp_id_set.add(seg.id)
        if seg.id not in req_id_set:
            extra_ids.add(seg.id)

    if duplicate_resp_ids:
        errors.append(
            AlignmentMismatchDetail(
                type="DUPLICATE_RESPONSE_ID",
                message="Response contains duplicate segment IDs: "
                + ", ".join(sorted(duplicate_resp_ids)),
                segment_ids=sorted(duplicate_resp_ids),
            )
        )

    if extra_ids:
        errors.append(
            AlignmentMismatchDetail(
                type="EXTRA_SEGMENT",
                message="Response contains unknown segment IDs not in request: "
                + ", ".join(sorted(extra_ids)),
                segment_ids=sorted(extra_ids),
            )
        )

    missing_ids = [seg_id for seg_id in req_id_set if seg_id not in resp_id_set]
    if missing_ids:
        errors.append(
            AlignmentMismatchDetail(
                type="MISSING_SEGMENT",
                message="Response is missing segment IDs from request: "
                + ", ".join(sorted(missing_ids)),
                segment_ids=sorted(missing_ids),
            )
        )

    return TranslationAlignmentValidationResult(valid=not errors, errors=errors)


def assert_translation_alignment(request: TranslationRequest, response: TranslationResponse) -> None:
    """断言严格对齐，若不对齐则抛出 AppError(ErrorCode.ALIGNMENT_MISMATCH)。"""
    result = validate_translation_alignment(request, response)
    if not result.valid:
        message = "; ".join(err.message for err in result.errors)
        raise AppError(
            ErrorCode.ALIGNMENT_MISMATCH,
            f"Translation alignment check failed: {message}",
            {"validationErrors": [err.dump() for err in result.errors]},
        )


def align_translation_results(
    request: TranslationRequest, response: TranslationResponse
) -> list[TranslationSegmentResult]:
    """按请求原始顺序重排响应结果；缺失段落补齐错误项而非崩溃。"""
    resp_map = {item.id: item for item in response.segments}
    aligned: list[TranslationSegmentResult] = []
    for seg in request.segments:
        found = resp_map.get(seg.id)
        if found is not None:
            aligned.append(found)
        else:
            aligned.append(
                TranslationSegmentResult(
                    id=seg.id,
                    translation="",
                    error={
                        "code": ErrorCode.ALIGNMENT_MISMATCH,
                        "message": f"Missing segment in provider response for ID: {seg.id}",
                    },
                )
            )
    return aligned
