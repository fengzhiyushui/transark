"""云端服务配置（pydantic-settings）。

所有配置项均可通过环境变量覆盖，前缀为 ``CLOUD_``，
例如 ``CLOUD_PORT=8780``、``CLOUD_API_KEYS=key1,key2``。

设计要点：
- 服务端不部署大模型，翻译全部转发到第三方 API（协议适配复用
  ``local_service.engines``）；Provider 由 ``providers_json``（完整配置数组）
  或 ``provider_*`` 单项配置注入，密钥只存在于服务端环境变量中。
- ASR 默认使用 faster-whisper（int8，CPU 可跑），模型权重首次请求时
  按需下载/加载，不打包进容器镜像。
- Redis 为可选缓存后端，未配置时退化为进程内 LRU 缓存。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_data_dir() -> Path:
    env = os.environ.get("CLOUD_DATA_DIR")
    if env:
        return Path(env).expanduser()
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "transark-cloud"
    return Path.home() / ".local" / "share" / "transark-cloud"


class CloudSettings(BaseSettings):
    """云端服务运行时配置。"""

    model_config = SettingsConfigDict(
        env_prefix="CLOUD_",
        env_file=None,
        extra="ignore",
        case_sensitive=False,
    )

    # ---- 网络基座 ----
    host: str = Field(default="0.0.0.0", description="监听地址")
    port: int = Field(default=8780, ge=1, le=65535, description="监听端口")
    data_dir: Path = Field(default_factory=_default_data_dir, description="数据目录（缓存/配置持久化）")

    # ---- 鉴权与限流 ----
    api_keys: str = Field(default="", description="逗号分隔的客户端 API Key 列表")
    allow_anonymous: bool = Field(
        default=False, description="开发模式：api_keys 为空时允许匿名访问（生产环境必须为 false）"
    )
    rate_limit_rpm: int = Field(default=60, ge=1, description="每个 API Key 每分钟请求上限")

    # ---- 翻译 Provider（密钥仅存服务端） ----
    default_profile_id: str = Field(default="cloud-default", description="默认翻译 Profile ID")
    providers_json: str | None = Field(
        default=None,
        description="JSON 数组：完整的 TranslationProviderConfig 列表（多 Provider 时使用）",
    )
    provider_protocol: str = Field(default="openai-chat", description="默认 Provider 协议")
    provider_base_url: str = Field(default="https://api.deepseek.com/v1", description="默认 Provider BaseUrl")
    provider_model: str = Field(default="deepseek-chat", description="默认模型")
    provider_api_key: str = Field(default="", description="默认 Provider 的 API Key（仅存服务端环境变量）")
    provider_name: str = Field(default="Cloud Default (OpenAI Compatible)", description="默认 Provider 名称")

    # ---- ASR ----
    asr_engine: Literal["faster-whisper", "whisper-cpp", "mock"] = Field(
        default="faster-whisper", description="ASR 引擎；mock 仅供测试"
    )
    asr_model_id: str = Field(default="base", description="faster-whisper 模型档位（tiny/base/small/...）")
    whisper_binary: str | None = Field(default=None, description="whisper.cpp 可执行文件路径")
    asr_model_path: str | None = Field(default=None, description="whisper.cpp ggml 模型权重路径")
    asr_chunk_seconds: float = Field(default=5.0, gt=0.0, description="流式 ASR 单次转写窗口（秒）")
    asr_overlap_seconds: float = Field(default=0.5, ge=0.0, description="相邻窗口重叠（秒，用于去重衔接）")

    # ---- 缓存 ----
    redis_url: str | None = Field(default=None, description="Redis 连接串；为空时使用进程内 LRU 缓存")
    cache_ttl_seconds: int = Field(default=86400, ge=0, description="译文缓存 TTL（秒，0 关闭）")
    cache_max_entries: int = Field(default=10000, ge=1, description="进程内缓存上限（无 Redis 时生效）")

    # ---- 长任务 ----
    max_concurrent_jobs: int = Field(default=4, ge=1, description="并发长任务上限（整段转写等）")

    # ---- 日志 ----
    log_level: str = Field(default="INFO", description="日志级别")

    def parsed_api_keys(self) -> list[str]:
        return [key.strip() for key in self.api_keys.split(",") if key.strip()]
