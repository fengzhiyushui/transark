"""云端服务路由包。"""

from .routes_asr import router as asr_router
from .routes_subtitles import router as subtitles_router

__all__ = ["asr_router", "subtitles_router"]
