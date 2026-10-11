"""提供者配置契约模型（与 packages/contracts/src/config.ts 对齐）。"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .base import ContractModel

DataPolicy = Literal["device-only", "allow-lan", "allow-cloud"]
TranslationProtocol = str  # 开放联合类型，见 contracts/src/config.ts
DeploymentLocation = Literal["loopback", "lan", "cloud", "unverified"]
ProcessingLocation = Literal["local", "lan", "cloud", "unverified"]
AuthType = Literal["none", "bearer", "api-key", "custom"]


class ProviderAuthConfig(ContractModel):
    """服务凭据与认证配置。"""

    type: AuthType = "none"
    secret_ref: str | None = Field(default=None, description="受保护凭据的存储引用标识")
    token: str | None = Field(default=None, description="Bearer 明文 Token")
    api_key: str | None = Field(default=None, description="API Key")
    header_name: str | None = Field(default=None, description="自定义鉴权 Header 键名")


class ProviderCapabilities(ContractModel):
    """服务端点能力声明。"""

    text_translation: bool = False
    ocr: bool = False
    asr: bool = False
    timestamps: bool | None = None
    streaming: bool | None = None
    structured_output: bool | None = None
    async_jobs: bool | None = None


class ProviderLimits(ContractModel):
    """请求限额与资源配额约束。"""

    max_batch_size: int | None = Field(default=None, ge=1)
    max_input_length: int | None = Field(default=None, ge=1)
    concurrency: int | None = Field(default=None, ge=1)
    timeout_ms: int | None = Field(default=None, ge=1)
    rate_limit_rpm: int | None = Field(default=None, ge=1)


class TranslationProviderConfig(ContractModel):
    """翻译服务提供者配置实体。"""

    profile_id: str = Field(description="唯一配置 Profile 标识")
    revision: int = Field(ge=0, description="配置版本号，修改时递增以隔离缓存")
    name: str = Field(description="人类可读的服务名称")
    protocol: TranslationProtocol = Field(description="适配器通信协议")
    base_url: str = Field(description="API 基础根路径（保留反向代理子路径）")
    model: str = Field(description="模型标识或网关别名")
    auth: ProviderAuthConfig = Field(description="鉴权凭据配置")
    data_policy: DataPolicy = Field(description="数据隐私策略")
    deployment_location: DeploymentLocation | None = None
    processing_location: ProcessingLocation | None = None
    capabilities: ProviderCapabilities = Field(description="服务能力声明")
    limits: ProviderLimits | None = None
    custom_headers: dict[str, str] | None = None
    is_default: bool | None = None
    enabled: bool | None = True
