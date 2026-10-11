"""契约模型包：与 packages/contracts (TypeScript) 一一对应。"""

from .alignment import (
    AlignmentMismatchDetail,
    AlignmentMismatchType,
    TranslationAlignmentValidationResult,
    align_translation_results,
    assert_translation_alignment,
    validate_translation_alignment,
)
from .asr import AsrCue, AsrRequest, AsrResponse
from .base import ContractModel, to_camel
from .config import (
    AuthType,
    DataPolicy,
    DeploymentLocation,
    ProcessingLocation,
    ProviderAuthConfig,
    ProviderCapabilities,
    ProviderLimits,
    TranslationProviderConfig,
    TranslationProtocol,
)
from .error import (
    ERROR_CODE_HTTP_STATUS,
    AppError,
    ErrorBody,
    ErrorCode,
    ErrorEnvelope,
    is_app_error,
)
from .job import (
    JobCreateRequest,
    JobDescriptor,
    JobErrorInfo,
    JobListResponse,
    JobProgressEvent,
    JobStatus,
    JobType,
    is_job_active,
    is_job_terminal,
)
from .ocr import Bbox, OcrBlock, OcrRequest, OcrResponse
from .translation import (
    ResolvedEngineInfo,
    SegmentError,
    TranslationMetrics,
    TranslationOptions,
    TranslationRequest,
    TranslationResponse,
    TranslationSegment,
    TranslationSegmentResult,
)

__all__ = [
    # base
    "ContractModel",
    "to_camel",
    # error
    "AppError",
    "ErrorCode",
    "ErrorBody",
    "ErrorEnvelope",
    "ERROR_CODE_HTTP_STATUS",
    "is_app_error",
    # translation
    "TranslationSegment",
    "TranslationOptions",
    "TranslationRequest",
    "TranslationSegmentResult",
    "SegmentError",
    "ResolvedEngineInfo",
    "TranslationMetrics",
    "TranslationResponse",
    # config
    "DataPolicy",
    "TranslationProtocol",
    "DeploymentLocation",
    "ProcessingLocation",
    "AuthType",
    "ProviderAuthConfig",
    "ProviderCapabilities",
    "ProviderLimits",
    "TranslationProviderConfig",
    # ocr
    "Bbox",
    "OcrBlock",
    "OcrRequest",
    "OcrResponse",
    # asr
    "AsrCue",
    "AsrRequest",
    "AsrResponse",
    # job
    "JobStatus",
    "JobType",
    "JobProgressEvent",
    "JobDescriptor",
    "JobCreateRequest",
    "JobListResponse",
    "JobErrorInfo",
    "is_job_terminal",
    "is_job_active",
    # alignment
    "AlignmentMismatchDetail",
    "AlignmentMismatchType",
    "TranslationAlignmentValidationResult",
    "validate_translation_alignment",
    "assert_translation_alignment",
    "align_translation_results",
]
