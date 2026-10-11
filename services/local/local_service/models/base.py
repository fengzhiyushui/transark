"""Pydantic 模型基座：与 packages/contracts (TypeScript) 的字段命名严格对齐。

约定：
- Python 侧使用 snake_case 字段名，JSON 序列化统一输出 camelCase（契约字段名）；
- 入参同时接受 camelCase（契约）与 snake_case（``populate_by_name``）；
- 默认 ``extra='forbid'``：未知字段一律拒绝，保证严格校验。
"""

from __future__ import annotations

import base64
import binascii
import re

from pydantic import BaseModel, ConfigDict


def to_camel(snake: str) -> str:
    """snake_case → camelCase（与 TS 契约字段名一致）。"""
    head, *rest = snake.split("_")
    return head + "".join(word[:1].upper() + word[1:] for word in rest if word)


def ensure_base64_payload(value: str, *, field: str) -> str:
    """校验 Base64 内容字段（容忍 data URI 前缀与空白）。

    用于 imageData / audioData / data 等契约字段：在请求进入业务逻辑前
    即拒绝明显非法的编码内容，返回 INVALID_REQUEST。
    """
    text = value.strip()
    if text.startswith("data:"):
        _header, _, payload = text.partition(",")
        text = payload
    compact = re.sub(r"\s+", "", text)
    if not compact:
        raise ValueError(f"字段 {field} 内容为空")
    try:
        base64.b64decode(compact, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"字段 {field} 不是合法的 Base64 内容") from exc
    return value


class ContractModel(BaseModel):
    """所有契约模型的基类。"""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        validate_assignment=False,
    )

    def dump(self) -> dict:
        """按契约 camelCase 输出可 JSON 序列化的字典。"""
        return self.model_dump(by_alias=True, mode="json")

    def dump_json(self) -> str:
        return self.model_dump_json(by_alias=True)
