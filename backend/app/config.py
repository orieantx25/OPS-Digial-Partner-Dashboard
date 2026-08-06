"""Application configuration loaded from environment variables."""

from functools import lru_cache
import os
from pathlib import Path
from typing import List

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Digital Partner Analytics"
    app_env: str = "development"
    debug: bool = True
    secret_key: str = "change-me-in-production"
    api_prefix: str = "/api/v1"

    leadsquared_access_key: str = ""
    leadsquared_secret_key: str = ""
    leadsquared_api_host: str = "https://api-in21.leadsquared.com/v2"
    leadsquared_sync_enabled: bool = False
    leadsquared_page_size: int = 1000
    leadsquared_sync_workers: int = 3
    sync_admin_token: str = ""
    leadership_auto_deploy_on_sync: bool = False

    # Security (production defaults applied in validator)
    require_api_auth: bool = False
    rate_limit_enabled: bool = True
    rate_limit_per_minute: int = 120
    rate_limit_login_per_minute: int = 10
    rate_limit_sensitive_per_minute: int = 20
    disable_openapi: bool = False

    google_refund_spreadsheet_id: str = ""
    google_refund_sheet_name: str = ""
    google_refund_sheet_gid: str = "0"
    google_refund_public_csv_url: str = ""
    google_service_account_json: str = ""

    data_dir: Path = Path("./data")
    parquet_dir: Path = Path("./data/parquet")
    metadata_db_url: str = "sqlite:///./data/metadata.db"
    duckdb_path: Path = Path("./data/analytics.duckdb")

    max_upload_size_mb: int = 5120
    max_files_per_batch: int = 100
    allowed_extensions: str = ".xlsx,.xls,.csv,.zip"

    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    cors_origins: str = "http://localhost:3000"

    analytics_cache_ttl_seconds: int = 300
    log_level: str = "INFO"

    @model_validator(mode="after")
    def _validate_leadsquared_config(self) -> "Settings":
        # Keys are validated at sync time via leadsquared_configured; allow the
        # API to start with LEADSQUARED_SYNC_ENABLED=true while keys are unset.
        self.leadsquared_page_size = max(1, min(int(self.leadsquared_page_size), 5000))
        self.leadsquared_sync_workers = max(1, min(int(self.leadsquared_sync_workers), 8))
        if self.app_env.lower() in ("production", "prod"):
            self.require_api_auth = True
            self.disable_openapi = True
            if self.leadsquared_sync_enabled and not self.sync_admin_token.strip():
                # Force explicit sync token in production when LSQ sync is on
                pass  # logged at startup; sync endpoint checks in production
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in ("production", "prod")

    @property
    def leadsquared_configured(self) -> bool:
        return bool(
            self.leadsquared_sync_enabled
            and self.leadsquared_access_key.strip()
            and self.leadsquared_secret_key.strip()
        )

    @property
    def google_refund_public_csv_url_resolved(self) -> str:
        explicit = self.google_refund_public_csv_url.strip()
        if explicit:
            return explicit
        sheet_id = self.google_refund_spreadsheet_id.strip()
        if not sheet_id:
            return ""
        gid = self.google_refund_sheet_gid.strip() or "0"
        return (
            f"https://docs.google.com/spreadsheets/d/{sheet_id}/export"
            f"?format=csv&gid={gid}"
        )

    @property
    def google_refund_public_csv_configured(self) -> bool:
        return bool(self.google_refund_public_csv_url_resolved)

    @property
    def google_sheets_service_account_configured(self) -> bool:
        path = self.google_service_account_json.strip()
        if path and Path(path).exists():
            return True
        creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        return bool(creds and Path(creds).exists())

    @property
    def google_sheets_configured(self) -> bool:
        return self.google_refund_public_csv_configured or (
            self.google_refund_spreadsheet_id.strip()
            and self.google_sheets_service_account_configured
        )

    @property
    def google_sheets_api_configured(self) -> bool:
        if not self.google_refund_spreadsheet_id.strip():
            return False
        return self.google_sheets_service_account_configured

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_extension_list(self) -> List[str]:
        return [e.strip().lower() for e in self.allowed_extensions.split(",") if e.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.parquet_dir.mkdir(parents=True, exist_ok=True)
        self.duckdb_path.parent.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings


def reload_settings() -> Settings:
    """Drop cached settings (e.g. after .env edit) and reload."""
    get_settings.cache_clear()
    return get_settings()
