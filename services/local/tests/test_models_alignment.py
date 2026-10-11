"""契约模型与对齐逻辑测试（对应 packages/contracts 的 TS 测试用例）。"""

from __future__ import annotations

import pytest

from local_service.models import (
    AppError,
    ErrorCode,
    JobStatus,
    TranslationRequest,
    TranslationResponse,
    align_translation_results,
    assert_translation_alignment,
    is_job_active,
    is_job_terminal,
    validate_translation_alignment,
)
from local_service.models.base import to_camel

from . import contract_data


def test_error_codes_match_ts_contracts():
    assert [code.value for code in ErrorCode] == contract_data.ERROR_CODES


def test_camel_case_alias_generation():
    assert to_camel("request_id") == "requestId"
    assert to_camel("source_language") == "sourceLanguage"
    assert to_camel("page_number") == "pageNumber"
    assert to_camel("duration_ms") == "durationMs"
    assert to_camel("start_time") == "startTime"
    assert to_camel("cache_hit") == "cacheHit"
    assert to_camel("id") == "id"


def test_translation_request_parses_contract_payload():
    """TS 契约的 mock 请求应被严格解析（camelCase 入参）。"""
    request = TranslationRequest.model_validate(contract_data.MOCK_TRANSLATION_REQUEST)
    assert request.request_id == "req-mock-trans-001"
    assert request.source_language == "en"
    assert request.target_language == "zh-CN"
    assert [seg.id for seg in request.segments] == ["seg-1", "seg-2", "seg-3"]
    assert request.options.temperature == 0.2
    assert request.options.preserve_terminology is True


def test_translation_request_rejects_unknown_fields():
    payload = dict(contract_data.MOCK_TRANSLATION_REQUEST)
    payload["unknownField"] = "x"
    with pytest.raises(Exception) as exc_info:
        TranslationRequest.model_validate(payload)
    assert "unknownField" in str(exc_info.value)


def test_translation_request_validates_temperature_range():
    payload = dict(contract_data.MOCK_TRANSLATION_REQUEST)
    payload["options"] = {"temperature": 1.5}
    with pytest.raises(Exception):
        TranslationRequest.model_validate(payload)


def test_response_serializes_contract_field_names():
    response = TranslationResponse.model_validate(
        {
            "requestId": "req-1",
            "segments": [{"id": "seg-1", "translation": "你好"}],
            "resolvedEngine": {"id": "built-in/hybrid", "revision": "rev-1", "actualLocation": "local"},
            "metrics": {"durationMs": 12, "promptTokens": 3, "completionTokens": 4, "cacheHit": False},
        }
    )
    dumped = response.dump()
    assert dumped["requestId"] == "req-1"
    assert dumped["segments"][0]["id"] == "seg-1"
    assert dumped["resolvedEngine"]["actualLocation"] == "local"
    assert dumped["metrics"]["durationMs"] == 12


def test_alignment_validation_passes_for_mock_data():
    request = TranslationRequest.model_validate(contract_data.MOCK_TRANSLATION_REQUEST)
    response = TranslationResponse.model_validate(
        {
            "requestId": request.request_id,
            "segments": [
                {"id": seg_id, "translation": text}
                for seg_id, text in contract_data.MOCK_TRANSLATION_EXPECTED.items()
            ],
        }
    )
    result = validate_translation_alignment(request, response)
    assert result.valid is True
    assert result.errors == []
    # 断言版本不应抛错
    assert_translation_alignment(request, response)


def test_alignment_validation_detects_mismatch():
    request = TranslationRequest.model_validate(contract_data.MOCK_TRANSLATION_REQUEST)
    bad_response = TranslationResponse.model_validate(
        {
            "requestId": request.request_id,
            "segments": [
                {"id": "seg-1", "translation": "你好"},
                {"id": "seg-unknown", "translation": "未知"},
            ],
        }
    )
    validation = validate_translation_alignment(request, bad_response)
    assert validation.valid is False
    error_types = {error.type for error in validation.errors}
    assert "EXTRA_SEGMENT" in error_types
    assert "MISSING_SEGMENT" in error_types

    with pytest.raises(AppError) as exc_info:
        assert_translation_alignment(request, bad_response)
    assert exc_info.value.code == ErrorCode.ALIGNMENT_MISMATCH


def test_align_translation_results_fills_missing_segments():
    request = TranslationRequest.model_validate(contract_data.MOCK_TRANSLATION_REQUEST)
    partial = TranslationResponse.model_validate(
        {
            "requestId": request.request_id,
            "segments": [
                {"id": "seg-2", "translation": "段落2译文"},
                {"id": "seg-1", "translation": "段落1译文"},
            ],
        }
    )
    aligned = align_translation_results(request, partial)
    assert [item.id for item in aligned] == ["seg-1", "seg-2", "seg-3"]
    assert aligned[2].error is not None
    assert aligned[2].error.code == ErrorCode.ALIGNMENT_MISMATCH


def test_job_status_helpers():
    assert [status.value for status in JobStatus] == [
        "pending",
        "processing",
        "completed",
        "failed",
        "cancelled",
    ]
    assert is_job_terminal(JobStatus.COMPLETED) is True
    assert is_job_terminal(JobStatus.PROCESSING) is False
    assert is_job_active(JobStatus.PENDING) is True
    assert is_job_active(JobStatus.COMPLETED) is False
