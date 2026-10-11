"""错误码体系（与 packages/contracts/src/error.ts 对齐）。"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any

from .base import ContractModel


class ErrorCode(str, Enum):
    """统一错误码，取值与 TS ``ErrorCode`` 常量完全一致。"""

    AUTH_FAILED = "AUTH_FAILED"
    NETWORK_ERROR = "NETWORK_ERROR"
    RATE_LIMITED = "RATE_LIMITED"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    TIMEOUT = "TIMEOUT"
    POLICY_VIOLATION = "POLICY_VIOLATION"
    INVALID_REQUEST = "INVALID_REQUEST"
    ALIGNMENT_MISMATCH = "ALIGNMENT_MISMATCH"
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    UNSUPPORTED_PROTOCOL = "UNSUPPORTED_PROTOCOL"
    OFFLINE_REQUIRED = "OFFLINE_REQUIRED"
    CANCELLED = "CANCELLED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


# HTTP 状态码映射：与错误语义一一对应
ERROR_CODE_HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.AUTH_FAILED: 401,
    ErrorCode.NETWORK_ERROR: 502,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.MODEL_UNAVAILABLE: 503,
    ErrorCode.TIMEOUT: 504,
    ErrorCode.POLICY_VIOLATION: 403,
    ErrorCode.INVALID_REQUEST: 422,
    ErrorCode.ALIGNMENT_MISMATCH: 502,
    ErrorCode.RESOURCE_NOT_FOUND: 404,
    ErrorCode.UNSUPPORTED_PROTOCOL: 400,
    ErrorCode.OFFLINE_REQUIRED: 503,
    ErrorCode.CANCELLED: 409,
    ErrorCode.INTERNAL_ERROR: 500,
}


class AppError(Exception):
    """统一应用错误（与 TS ``AppError`` 对齐）。

    路由/引擎层只抛出本异常，由全局异常处理器转换为统一错误信封：
    ``{"error": {"name", "code", "message", "details", "timestamp"}}``
    """

    def __init__(self, code: ErrorCode, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
        self.timestamp = int(time.time() * 1000)

    @property
    def http_status(self) -> int:
        return ERROR_CODE_HTTP_STATUS.get(self.code, 500)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": "AppError",
            "code": self.code.value,
            "message": self.message,
            "details": self.details,
            "timestamp": self.timestamp,
        }


class ErrorBody(ContractModel):
    """错误信封中的 error 对象。"""

    name: str = "AppError"
    code: ErrorCode
    message: str
    details: dict = {}
    timestamp: int


class ErrorEnvelope(ContractModel):
    """统一错误响应信封。"""

    error: ErrorBody


def is_app_error(value: object) -> bool:
    return isinstance(value, AppError)
