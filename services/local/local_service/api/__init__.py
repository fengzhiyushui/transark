"""API 路由包。"""

from .deps import CurrentToken, Services, get_pairing, get_services, require_token
from .routes_documents import router as documents_router
from .routes_health import router as health_router
from .routes_jobs import router as jobs_router
from .routes_offline import router as offline_router
from .routes_pair import router as pair_router
from .routes_providers import router as providers_router
from .routes_translate import router as translate_router

__all__ = [
    "CurrentToken",
    "Services",
    "get_pairing",
    "get_services",
    "require_token",
    "health_router",
    "pair_router",
    "translate_router",
    "documents_router",
    "jobs_router",
    "offline_router",
    "providers_router",
]
