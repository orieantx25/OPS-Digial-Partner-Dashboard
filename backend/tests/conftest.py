"""Shared pytest fixtures for backend tests."""

import tempfile
from pathlib import Path

import pytest

from app.config import Settings


@pytest.fixture
def temp_settings():
    with tempfile.TemporaryDirectory() as tmp:
        data_dir = Path(tmp)
        settings = Settings(
            data_dir=data_dir,
            parquet_dir=data_dir / "parquet",
            duckdb_path=data_dir / "analytics.duckdb",
            metadata_db_url=f"sqlite:///{data_dir / 'test.db'}",
        )
        settings.ensure_directories()
        yield settings
        try:
            from app.infrastructure.duckdb_repo import DuckDBRepository

            DuckDBRepository(settings).invalidate_metadata_cache()
        except Exception:
            pass
