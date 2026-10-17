"""服务入口：python -m cloud_service"""

from __future__ import annotations

import logging
import sys


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )


def main() -> None:
    import uvicorn

    from .app import create_app
    from .settings import CloudSettings

    settings = CloudSettings()
    _configure_logging(settings.log_level)

    app = create_app(settings)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        access_log=True,
    )


if __name__ == "__main__":
    main()
