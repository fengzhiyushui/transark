"""服务配置（pydantic-settings）。

所有配置项均可通过环境变量覆盖，前缀为 ``LOCAL_SERVICE_``，
例如 ``LOCAL_SERVICE_PORT=8765``、``LOCAL_SERVICE_DATA_DIR=./data``。

设计约束：
- 服务只允许绑定回环地址（127.0.0.0/8、::1、localhost）；
  确需非回环绑定时必须显式设置 ``allow_non_loopback_bind=true``。
- 云端出口默认关闭（``allow_cloud_egress=false``），
  任何非回环/非局域网请求都会经过 :class:`~local_service.netguard.NetworkGuard`
  校验，违反数据策略时直接拒绝，绝不静默外网回退。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}


def _default_data_dir() -> Path:
    """默认数据目录：Windows 使用 %LOCALAPPDATA%，其余平台使用 ~/.local/share。"""
    env = os.environ.get("LOCAL_SERVICE_DATA_DIR")
    if env:
        return Path(env).expanduser()
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "translate-local-service"
    return Path.home() / ".local" / "share" / "translate-local-service"


def is_loopback_host(host: str) -> bool:
    """判断主机名/IP 是否属于本机回环。"""
    candidate = host.strip().strip("[]").lower()
    if candidate in LOOPBACK_HOSTS:
        return True
    if candidate.startswith("127."):
        return True
    return False


class Settings(BaseSettings):
    """本地伴随服务运行时配置。"""

    model_config = SettingsConfigDict(
        env_prefix="LOCAL_SERVICE_",
        env_file=None,
        extra="ignore",
        case_sensitive=False,
    )

    # ---- 网络基座 ----
    host: str = Field(default="127.0.0.1", description="监听地址，默认仅回环")
    port: int = Field(default=8765, ge=1, le=65535, description="监听端口")
    allow_non_loopback_bind: bool = Field(
        default=False, description="允许绑定非回环地址（不推荐，仅调试用）"
    )

    # ---- 配对鉴权 ----
    data_dir: Path = Field(default_factory=_default_data_dir, description="本地数据目录")
    pairing_code: str | None = Field(
        default=None, description="固定配对码；为空时自动生成并持久化到数据目录"
    )
    token_ttl_seconds: int = Field(default=86_400, ge=60, description="配对令牌有效期（秒）")
    pair_max_failures: int = Field(default=5, ge=1, description="配对失败锁定阈值")
    pair_lock_seconds: int = Field(default=60, ge=1, description="配对失败锁定时长（秒）")

    # ---- 翻译与引擎 ----
    default_profile_id: str = Field(
        default="local-companion-service", description="请求未指定 profileId 时的默认配置"
    )
    allow_cloud_egress: bool = Field(
        default=False, description="是否允许向公网端点发起请求（需用户显式授权）"
    )
    offline_mode: bool = Field(
        default=False, description="离线模式：仅允许回环请求，任何外网/局域网请求一律拒绝"
    )
    translation_cache_ttl_seconds: int = Field(default=900, ge=0, description="翻译缓存 TTL（秒，0 关闭）")
    translation_cache_max_entries: int = Field(default=2048, ge=1, description="翻译缓存最大条目数")

    # ---- 长任务 ----
    max_concurrent_jobs: int = Field(default=2, ge=1, description="并发执行的长任务上限")
    job_cancel_grace_seconds: float = Field(default=2.0, ge=0.0, description="协作取消等待时长（秒）")

    # ---- OCR / ASR 本地资源 ----
    ocr_engine: Literal["auto", "mock", "tesseract"] = Field(
        default="auto", description="OCR 引擎选择：auto 优先本地 tesseract，缺失时返回明确错误"
    )
    tesseract_binary: str | None = Field(default=None, description="tesseract 可执行文件路径（默认查 PATH）")
    asr_engine: Literal["auto", "mock", "whisper-cpp", "faster-whisper"] = Field(
        default="auto", description="ASR 引擎选择：auto 优先 whisper.cpp / faster-whisper，缺失时返回明确错误"
    )
    whisper_binary: str | None = Field(default=None, description="whisper.cpp 可执行文件路径")
    asr_model_path: str | None = Field(default=None, description="whisper.cpp ggml 模型权重路径")
    asr_model_id: str = Field(default="ggml-medium.bin", description="ASR 模型标识（用于能力报告）")

    # ---- 离线自检 ----
    offline_probe: bool = Field(default=True, description="离线自检时是否探测本地引擎连通性（仅回环）")

    # ---- 日志 ----
    log_level: str = Field(default="INFO", description="日志级别")

    def model_post_init(self, __context: object) -> None:
        if not is_loopback_host(self.host) and not self.allow_non_loopback_bind:
            raise ValueError(
                f"拒绝绑定非回环地址 {self.host!r}：本地伴随服务仅允许回环监听；"
                "如确有需要请显式设置 LOCAL_SERVICE_ALLOW_NON_LOOPBACK_BIND=true"
            )
        if self.offline_mode and self.allow_cloud_egress:
            raise ValueError("offline_mode=true 时不允许 allow_cloud_egress=true（离线模式禁止公网出口）")

    @property
    def is_loopback(self) -> bool:
        return is_loopback_host(self.host)

    def ensure_data_dir(self) -> Path:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return self.data_dir
