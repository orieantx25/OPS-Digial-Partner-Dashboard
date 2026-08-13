"""Digital Partners Analytics Platform - FastAPI Application."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admissions, analytics, auth, block_payment, persona_activity, refunds, sync, upload
from app.config import get_settings
from app.infrastructure.database import init_metadata_db
from app.logging_config import get_logger, setup_logging
from app.middleware.security import RateLimitMiddleware, SecurityHeadersMiddleware
from app.services.auth_service import AuthService

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.ensure_directories()
    init_metadata_db()
    AuthService().seed_users()
    if settings.is_production and settings.leadsquared_sync_enabled:
        if not settings.sync_admin_token.strip():
            logger.warning(
                "security_sync_token_missing",
                hint="Set SYNC_ADMIN_TOKEN in production to protect sync endpoints",
            )
    logger.info(
        "application_started",
        env=settings.app_env,
        require_api_auth=settings.require_api_auth,
    )
    yield
    logger.info("application_shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="2.0.0",
        lifespan=lifespan,
        docs_url=None if settings.disable_openapi else "/docs",
        redoc_url=None if settings.disable_openapi else "/redoc",
        openapi_url=None if settings.disable_openapi else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Sync-Token"],
    )
    app.add_middleware(
        RateLimitMiddleware,
        max_requests=settings.rate_limit_per_minute,
        window_seconds=60,
    )
    app.add_middleware(SecurityHeadersMiddleware)

    prefix = settings.api_prefix
    app.include_router(auth.router, prefix=prefix)
    app.include_router(upload.router, prefix=prefix)
    app.include_router(block_payment.router, prefix=prefix)
    app.include_router(refunds.router, prefix=prefix)
    app.include_router(admissions.router, prefix=prefix)
    app.include_router(persona_activity.router, prefix=prefix)
    app.include_router(sync.router, prefix=prefix)
    app.include_router(analytics.router, prefix=prefix)

    @app.get("/health")
    async def health():
        if settings.is_production:
            return {"status": "healthy"}
        return {"status": "healthy", "version": "2.0.0"}

    return app


app = create_app()
