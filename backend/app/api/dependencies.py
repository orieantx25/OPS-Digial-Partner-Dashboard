"""FastAPI dependency injection."""

from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.domain.models import FilterParams, UserInfo, UserRole
from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
from app.services.analytics_service import AnalyticsEngine
from app.services.auth_service import AuthService
from app.services.ingestion_service import IngestionEngine

security = HTTPBearer(auto_error=False)

_auth_service: Optional[AuthService] = None
_duck_repo: Optional[DuckDBRepository] = None
_cache: Optional[AnalyticsCache] = None
_ingestion: Optional[IngestionEngine] = None
_analytics: Optional[AnalyticsEngine] = None


def get_auth_service() -> AuthService:
    global _auth_service
    if _auth_service is None:
        _auth_service = AuthService()
    return _auth_service


def get_duck_repo() -> DuckDBRepository:
    global _duck_repo
    if _duck_repo is None:
        _duck_repo = DuckDBRepository()
    return _duck_repo


def get_cache() -> AnalyticsCache:
    global _cache
    if _cache is None:
        from app.config import get_settings
        _cache = AnalyticsCache(get_settings().analytics_cache_ttl_seconds)
    return _cache


def get_ingestion_engine() -> IngestionEngine:
    global _ingestion
    if _ingestion is None:
        _ingestion = IngestionEngine(duck_repo=get_duck_repo(), cache=get_cache())
    return _ingestion


def get_analytics_engine() -> AnalyticsEngine:
    global _analytics
    if _analytics is None:
        _analytics = AnalyticsEngine(duck_repo=get_duck_repo(), cache=get_cache())
    return _analytics


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    auth: AuthService = Depends(get_auth_service),
) -> UserInfo:
    if credentials is None:
        return UserInfo(id="anonymous", username="anonymous", role=UserRole.READ_ONLY)
    user = auth.decode_token(credentials.credentials)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return user


def require_write_access(user: UserInfo = Depends(get_current_user), auth: AuthService = Depends(get_auth_service)):
    if not auth.can_write(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Write access required")
    return user


def parse_filters(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    week: Optional[str] = None,
    month: Optional[str] = None,
    quarter: Optional[str] = None,
    year: Optional[int] = None,
    partner: Optional[str] = None,
    state: Optional[str] = None,
    city: Optional[str] = None,
    persona: Optional[str] = None,
    lead_stage: Optional[str] = None,
    contact_stage: Optional[str] = None,
    ai_status: Optional[str] = None,
    campaign: Optional[str] = None,
    source: Optional[str] = None,
    medium: Optional[str] = None,
    device: Optional[str] = None,
    prospect_id: Optional[str] = None,
    search: Optional[str] = None,
    lead_filter: Optional[str] = None,
    user: UserInfo = Depends(get_current_user),
    auth: AuthService = Depends(get_auth_service),
) -> FilterParams:
    def split_list(val: Optional[str]) -> Optional[list]:
        if not val:
            return None
        return [v.strip() for v in val.split(",") if v.strip()]

    data = {
        "date_from": date_from,
        "date_to": date_to,
        "week": week,
        "month": month,
        "quarter": quarter,
        "year": year,
        "partner": split_list(partner),
        "state": split_list(state),
        "city": split_list(city),
        "persona": split_list(persona),
        "lead_stage": split_list(lead_stage),
        "contact_stage": split_list(contact_stage),
        "ai_status": split_list(ai_status),
        "campaign": split_list(campaign),
        "source": split_list(source),
        "medium": split_list(medium),
        "device": split_list(device),
        "prospect_id": prospect_id,
        "search": search,
        "lead_filter": lead_filter,
    }
    scoped = auth.apply_partner_scope(user, {k: v for k, v in data.items() if v is not None})
    return FilterParams(**scoped)
