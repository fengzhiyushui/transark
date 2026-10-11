"""应用级服务容器（挂在 app.state.services 上）。"""

from __future__ import annotations

from dataclasses import dataclass

from .cache import TranslationCache
from .documents import DocumentService
from .engines import EngineRegistry
from .jobs import JobManager, build_handlers
from .netguard import NetworkGuard
from .offline import OfflineService
from .profiles import ProfileStore
from .security import PairingService
from .settings import Settings
from .translation_service import TranslationService


@dataclass
class AppServices:
    """服务实例集合。"""

    settings: Settings
    pairing: PairingService
    guard: NetworkGuard
    profiles: ProfileStore
    engines: EngineRegistry
    cache: TranslationCache
    translation: TranslationService
    documents: DocumentService
    jobs: JobManager
    offline: OfflineService


def build_services(settings: Settings) -> AppServices:
    """按配置构造全部服务实例。"""
    settings.ensure_data_dir()

    guard = NetworkGuard(settings)
    profiles = ProfileStore(settings.data_dir)
    engines = EngineRegistry(guard)
    cache = TranslationCache(
        ttl_seconds=settings.translation_cache_ttl_seconds,
        max_entries=settings.translation_cache_max_entries,
    )
    translation = TranslationService(
        profiles=profiles,
        engines=engines,
        guard=guard,
        cache=cache,
        default_profile_id=settings.default_profile_id,
    )
    documents = DocumentService()
    pairing = PairingService(
        pairing_code=settings.pairing_code,
        data_dir=settings.data_dir,
        token_ttl_seconds=settings.token_ttl_seconds,
        max_failures=settings.pair_max_failures,
        lock_seconds=settings.pair_lock_seconds,
    )
    jobs = JobManager(
        build_handlers(settings=settings, documents=documents, translation=translation),
        max_concurrent_jobs=settings.max_concurrent_jobs,
        cancel_grace_seconds=settings.job_cancel_grace_seconds,
    )
    offline = OfflineService(
        settings=settings,
        profiles=profiles,
        engines=engines,
        guard=guard,
        translation=translation,
    )

    return AppServices(
        settings=settings,
        pairing=pairing,
        guard=guard,
        profiles=profiles,
        engines=engines,
        cache=cache,
        translation=translation,
        documents=documents,
        jobs=jobs,
        offline=offline,
    )
