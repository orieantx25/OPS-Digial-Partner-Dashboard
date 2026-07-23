"""Digital Partners Analytics Platform - FastAPI Application."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import analytics, auth, block_payment, persona_activity, sync, upload
from app.config import get_settings
from app.infrastructure.database import init_metadata_db
from app.logging_config import get_logger, setup_logging
from app.services.auth_service import AuthService

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.ensure_directories()
    init_metadata_db()
    AuthService().seed_users()
    logger.info("application_started", env=settings.app_env)
    yield
    logger.info("application_shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="2.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    prefix = settings.api_prefix
    app.include_router(auth.router, prefix=prefix)
    app.include_router(upload.router, prefix=prefix)
    app.include_router(block_payment.router, prefix=prefix)
    app.include_router(persona_activity.router, prefix=prefix)
    app.include_router(sync.router, prefix=prefix)
    app.include_router(analytics.router, prefix=prefix)

    @app.get("/health")
    async def health():
        return {"status": "healthy", "version": "2.0.0"}

    return app


app = create_app()
