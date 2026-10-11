"""服务配置 Profile 存储。

- 内置种子配置（与 packages/contracts/src/mock.ts 中的 mock 配置对齐）：
  - ``local-companion-service``：本服务内置混合引擎（protocol=custom-translate），device-only；
  - ``local-ollama-qwen``：本地 Ollama（protocol=ollama），device-only；
- 用户自定义配置持久化在 ``{data_dir}/providers.json``，
  可通过 ``PUT /v1/providers/{profileId}`` 登记"用户填写的兼容端点"；
- 用户配置与内置种子同 ID 时覆盖内置种子；删除用户配置后回退到内置种子。
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterable

from .models import AppError, ErrorCode, TranslationProviderConfig

logger = logging.getLogger("local_service.profiles")

BUILTIN_LOCAL_COMPANION = TranslationProviderConfig(
    profileId="local-companion-service",
    revision=1,
    name="Local Companion Service (Built-in Hybrid)",
    protocol="custom-translate",
    baseUrl="http://127.0.0.1:8765/v1",
    model="built-in-hybrid",
    auth={"type": "none"},
    dataPolicy="device-only",
    deploymentLocation="loopback",
    processingLocation="local",
    capabilities={
        "textTranslation": True,
        "ocr": True,
        "asr": True,
        "timestamps": True,
        "streaming": False,
        "structuredOutput": True,
        "asyncJobs": True,
    },
    limits={"maxBatchSize": 100, "maxInputLength": 16000, "concurrency": 4, "timeoutMs": 30000},
    isDefault=True,
    enabled=True,
)

BUILTIN_OLLAMA_QWEN = TranslationProviderConfig(
    profileId="local-ollama-qwen",
    revision=1,
    name="Ollama Local (Qwen 2.5 7B)",
    protocol="ollama",
    baseUrl="http://127.0.0.1:11434",
    model="qwen2.5:7b",
    auth={"type": "none"},
    dataPolicy="device-only",
    deploymentLocation="loopback",
    processingLocation="local",
    capabilities={
        "textTranslation": True,
        "ocr": False,
        "asr": False,
        "timestamps": False,
        "streaming": True,
        "structuredOutput": True,
    },
    limits={"maxBatchSize": 20, "maxInputLength": 16000, "concurrency": 2, "timeoutMs": 45000},
    enabled=True,
)

BUILTIN_PROFILES: dict[str, TranslationProviderConfig] = {
    BUILTIN_LOCAL_COMPANION.profile_id: BUILTIN_LOCAL_COMPANION,
    BUILTIN_OLLAMA_QWEN.profile_id: BUILTIN_OLLAMA_QWEN,
}


class ProfileStore:
    """Profile 存储：内置种子 + 用户文件覆盖。"""

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = Path(data_dir)
        self._path = self._data_dir / "providers.json"
        self._user_profiles: dict[str, TranslationProviderConfig] = {}
        self._load()

    # -------------------------------------------------------------- persistence
    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("providers.json 解析失败，忽略用户配置: %s", exc)
            return
        for item in raw.get("profiders", []) if isinstance(raw, dict) else []:
            try:
                config = TranslationProviderConfig.model_validate(item)
            except Exception as exc:  # noqa: BLE001 - 单条配置损坏不影响其他配置
                logger.warning("跳过无效的 profile 配置: %s", exc)
                continue
            self._user_profiles[config.profile_id] = config

    def _save(self) -> None:
        try:
            self._data_dir.mkdir(parents=True, exist_ok=True)
            payload = {"version": 1, "profiders": [c.dump() for c in self._user_profiles.values()]}
            self._path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError as exc:
            raise AppError(
                ErrorCode.INTERNAL_ERROR,
                f"无法持久化服务配置到 {self._path}: {exc}",
            ) from exc

    # -------------------------------------------------------------------- CRUD
    def all(self) -> list[TranslationProviderConfig]:
        merged: dict[str, TranslationProviderConfig] = dict(BUILTIN_PROFILES)
        merged.update(self._user_profiles)
        return [merged[k] for k in sorted(merged)]

    def get(self, profile_id: str) -> TranslationProviderConfig:
        config = self._user_profiles.get(profile_id) or BUILTIN_PROFILES.get(profile_id)
        if config is None:
            raise AppError(
                ErrorCode.RESOURCE_NOT_FOUND,
                f"服务配置 Profile 不存在: {profile_id}",
                {"profileId": profile_id},
            )
        return config

    def is_builtin(self, profile_id: str) -> bool:
        return profile_id in BUILTIN_PROFILES

    def upsert(self, config: TranslationProviderConfig) -> TranslationProviderConfig:
        """登记或更新用户配置（含"用户填写的兼容端点"）。"""
        if config.enabled is None:
            config.enabled = True
        self._user_profiles[config.profile_id] = config
        self._save()
        return config

    def delete(self, profile_id: str) -> bool:
        """删除用户配置；内置种子本身不可删除（同 ID 的用户覆盖会被移除）。"""
        if profile_id in self._user_profiles:
            del self._user_profiles[profile_id]
            self._save()
            return True
        return False

    def enabled_profiles(self) -> Iterable[TranslationProviderConfig]:
        return (c for c in self.all() if c.enabled is not False)
