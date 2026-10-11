"""Loopback 配对鉴权。

流程：
1. 服务启动时确定配对码（环境变量 ``LOCAL_SERVICE_PAIRING_CODE`` 指定，
   否则自动生成 8 位配对码并持久化到 ``{data_dir}/pairing.json``）；
2. 扩展/客户端凭配对码调用 ``POST /v1/pair``，换取 Bearer 令牌；
3. 后续 ``/v1/*`` 请求携带 ``Authorization: Bearer <token>``。

配对码使用常量时间比较；连续失败达到阈值后短时锁定，防止暴力枚举。
令牌仅保存在进程内存中（服务重启需重新配对），日志绝不输出令牌本体。
"""

from __future__ import annotations

import json
import secrets
import time
from pathlib import Path
from typing import Literal

from pydantic import Field

from .models import AppError, ErrorCode
from .models.base import ContractModel

_PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉易混淆字符
_TOKEN_BYTES = 32


class PairRequest(ContractModel):
    """配对握手请求。"""

    pairing_code: str = Field(min_length=1, description="服务端配对码")
    client_id: str | None = Field(default=None, description="客户端标识")
    client_name: str | None = Field(default=None, description="客户端可读名称")


class PairResponse(ContractModel):
    """配对握手响应。"""

    token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_at: int = Field(description="过期时间戳（毫秒）")
    issued_at: int = Field(description="签发时间戳（毫秒）")
    service: str = "local-companion-service"
    loopback_only: bool = True


class TokenInfo(ContractModel):
    """已签发令牌的内存记录。"""

    token: str
    client_id: str | None = None
    client_name: str | None = None
    created_at: int
    expires_at: int


def _now_ms() -> int:
    return int(time.time() * 1000)


class PairingService:
    """配对码与令牌管理。"""

    def __init__(
        self,
        *,
        pairing_code: str | None,
        data_dir: Path,
        token_ttl_seconds: int = 86_400,
        max_failures: int = 5,
        lock_seconds: int = 60,
        service_name: str = "local-companion-service",
    ) -> None:
        self._data_dir = Path(data_dir)
        self._ttl_seconds = token_ttl_seconds
        self._max_failures = max_failures
        self._lock_seconds = lock_seconds
        self._service_name = service_name
        self._tokens: dict[str, TokenInfo] = {}
        self._failures = 0
        self._locked_until = 0.0
        self._pairing_code = pairing_code or self._load_or_create_pairing_code()

    # ----------------------------------------------------------- pairing code
    @property
    def pairing_code(self) -> str:
        return self._pairing_code

    @property
    def pairing_code_file(self) -> Path:
        return self._data_dir / "pairing.json"

    def _load_or_create_pairing_code(self) -> str:
        path = self.pairing_code_file
        try:
            if path.exists():
                data = json.loads(path.read_text(encoding="utf-8"))
                code = data.get("pairingCode")
                if isinstance(code, str) and code:
                    return code
        except (OSError, json.JSONDecodeError):
            pass
        code = "".join(secrets.choice(_PAIRING_ALPHABET) for _ in range(8))
        try:
            self._data_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(
                    {"pairingCode": code, "createdAt": _now_ms(), "note": "local companion pairing code"},
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
        except OSError:
            # 数据目录不可写时退化为仅内存配对码（重启后重新生成）
            pass
        return code

    # -------------------------------------------------------------- pairing
    def pair(
        self,
        pairing_code: str,
        *,
        client_id: str | None = None,
        client_name: str | None = None,
    ) -> PairResponse:
        now = time.monotonic()
        if now < self._locked_until:
            raise AppError(
                ErrorCode.AUTH_FAILED,
                "配对失败次数过多，已临时锁定，请稍后重试",
                {"retryAfterSeconds": max(1, int(self._locked_until - now))},
            )
        if not secrets.compare_digest(pairing_code.strip(), self._pairing_code):
            self._failures += 1
            if self._failures >= self._max_failures:
                self._locked_until = time.monotonic() + self._lock_seconds
                self._failures = 0
            raise AppError(ErrorCode.AUTH_FAILED, "配对码无效", {"attempts": self._failures})

        self._failures = 0
        token = secrets.token_urlsafe(_TOKEN_BYTES)
        issued_at = _now_ms()
        expires_at = issued_at + self._ttl_seconds * 1000
        self._tokens[token] = TokenInfo(
            token=token,
            client_id=client_id,
            client_name=client_name,
            created_at=issued_at,
            expires_at=expires_at,
        )
        return PairResponse(
            token=token,
            expires_at=expires_at,
            issued_at=issued_at,
            service=self._service_name,
        )

    # --------------------------------------------------------------- tokens
    def verify(self, token: str) -> TokenInfo:
        info = self._tokens.get(token)
        if info is None:
            raise AppError(ErrorCode.AUTH_FAILED, "无效或已过期的配对令牌，请重新配对")
        if info.expires_at < _now_ms():
            self._tokens.pop(token, None)
            raise AppError(ErrorCode.AUTH_FAILED, "配对令牌已过期，请重新配对")
        return info

    def revoke(self, token: str) -> bool:
        return self._tokens.pop(token, None) is not None

    def active_token_count(self) -> int:
        now = _now_ms()
        expired = [t for t, info in self._tokens.items() if info.expires_at < now]
        for token in expired:
            self._tokens.pop(token, None)
        return len(self._tokens)

    def redact(self, value: Any) -> Any:  # pragma: no cover - 日志脱敏工具
        if isinstance(value, str) and value in self._tokens:
            return "***redacted-token***"
        return value
