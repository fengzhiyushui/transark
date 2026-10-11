"""翻译契约模型（与 packages/contracts/src/translation.ts 对齐）。"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .base import ContractModel
from .error import ErrorCode


class TranslationSegment(ContractModel):
    """翻译文本单元。"""

    id: str = Field(description="单元唯一标识（DOM 节点 ID / 段落 ID / 字幕 cue ID）")
    text: str = Field(description="待翻译的原文文本")
    context: str | None = Field(default=None, description="上下文补充信息")


class TranslationOptions(ContractModel):
    """翻译选项配置。"""

    temperature: float | None = Field(default=None, ge=0.0, le=1.0, description="生成温度 0.0~1.0")
    format: Literal["text", "html", "markdown"] | None = Field(default=None, description="文本格式约定")
    preserve_terminology: bool | None = Field(default=None, description="是否保留专有名词与术语对照")
    session_id: str | None = Field(default=None, description="业务会话 ID")
    session_generation: int | None = Field(default=None, description="业务版本代次号")


class TranslationRequest(ContractModel):
    """统一翻译请求载荷。"""

    request_id: str = Field(description="请求唯一标识")
    source_language: str = Field(description="源语言代码（如 'en', 'auto'）")
    target_language: str = Field(description="目标语言代码（如 'zh-CN'）")
    segments: list[TranslationSegment] = Field(
        min_length=1, description="待翻译段落列表（ID 严格唯一，至少 1 段）"
    )
    profile_id: str | None = Field(default=None, description="绑定的服务配置 Profile ID")
    revision: int | None = Field(default=None, description="绑定的服务配置版本号")
    options: TranslationOptions | None = Field(default=None, description="请求级附加选项")


class SegmentError(ContractModel):
    """单段翻译错误。"""

    code: ErrorCode
    message: str


class TranslationSegmentResult(ContractModel):
    """单个段落的翻译结果。"""

    id: str
    translation: str
    error: SegmentError | None = None


class ResolvedEngineInfo(ContractModel):
    """实际执行推理的服务/引擎信息。"""

    id: str = Field(description="引擎或模型标识（如 'ollama/qwen2.5:7b'）")
    revision: str = Field(description="引擎或路由配置版本标识")
    actual_location: Literal["local", "lan", "cloud", "unverified"] | None = Field(
        default=None, description="实际物理处理位置"
    )


class TranslationMetrics(ContractModel):
    """翻译耗时与 Token 统计。"""

    duration_ms: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cache_hit: bool | None = None


class TranslationResponse(ContractModel):
    """统一翻译响应结构（段落与请求严格对齐）。"""

    request_id: str
    segments: list[TranslationSegmentResult]
    resolved_engine: ResolvedEngineInfo | None = None
    metrics: TranslationMetrics | None = None
