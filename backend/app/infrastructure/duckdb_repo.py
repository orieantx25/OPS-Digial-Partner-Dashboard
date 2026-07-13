"""DuckDB analytical storage repository."""

import hashlib
import json
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import duckdb

from app.config import Settings, get_settings
from app.domain.schema import (
    ALL_COLUMNS,
    BLOCK_PAYMENT_COLUMNS,
    BLOCK_PAYMENT_META_FILE,
    BLOCK_PAYMENT_PARQUET_FILE,
    BLOCK_PAYMENT_TABLE,
    BOOLEAN_COLUMNS,
    DATE_COLUMNS,
    MASTER_DATASET_TABLE,
    MASTER_PARQUET_FILE,
    NUMERIC_COLUMNS,
    PERSONA_ACTIVITY_COLUMNS,
    PERSONA_ACTIVITY_META_FILE,
    PERSONA_ACTIVITY_PARQUET_FILE,
    PERSONA_ACTIVITY_TABLE,
)
from app.logging_config import get_logger

logger = get_logger(__name__)

_lock = threading.Lock()


class DuckDBRepository:
    """Repository for MASTER_DATASET analytics queries via DuckDB + Parquet."""

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self.parquet_path = self.settings.parquet_dir / MASTER_PARQUET_FILE
        self.block_payment_path = self.settings.parquet_dir / BLOCK_PAYMENT_PARQUET_FILE
        self.block_payment_meta_path = self.settings.parquet_dir / BLOCK_PAYMENT_META_FILE
        self.persona_activity_path = self.settings.parquet_dir / PERSONA_ACTIVITY_PARQUET_FILE
        self.persona_activity_meta_path = self.settings.parquet_dir / PERSONA_ACTIVITY_META_FILE
        self.duckdb_path = self.settings.duckdb_path

    def _connect(self) -> duckdb.DuckDBPyConnection:
        conn = duckdb.connect(str(self.duckdb_path))
        conn.execute("SET threads TO 4")
        conn.execute("SET memory_limit = '4GB'")
        return conn

    def master_exists(self) -> bool:
        return self.parquet_path.exists()

    def block_payment_exists(self) -> bool:
        return self.block_payment_path.exists()

    def persona_activity_exists(self) -> bool:
        return self.persona_activity_path.exists()

    def _unlink_block_payment_files(self) -> None:
        if self.block_payment_path.exists():
            self.block_payment_path.unlink()
        if self.block_payment_meta_path.exists():
            self.block_payment_meta_path.unlink()

    def _unlink_persona_activity_files(self) -> None:
        if self.persona_activity_path.exists():
            self.persona_activity_path.unlink()
        if self.persona_activity_meta_path.exists():
            self.persona_activity_meta_path.unlink()

    def clear_block_payment(self) -> None:
        """Delete block payment back-tracking sheet (cleared when master dataset is replaced)."""
        with _lock:
            self._unlink_block_payment_files()
        logger.info("block_payment_tracking_cleared")

    def clear_persona_activity(self) -> None:
        """Delete persona last-24h activity report."""
        with _lock:
            self._unlink_persona_activity_files()
        logger.info("persona_activity_cleared")

    def clear_master(self) -> None:
        """Delete MASTER_DATASET and its materialized views (used for replace-on-upload).

        Block payment back-tracking sheet is intentionally NOT cleared —
        it is an independent upload lifecycle.
        """
        with _lock:
            if self.parquet_path.exists():
                self.parquet_path.unlink()
            conn = self._connect()
            try:
                conn.execute("DROP TABLE IF EXISTS mv_kpi_daily")
                conn.execute("DROP TABLE IF EXISTS mv_partner_summary")
            finally:
                conn.close()
        logger.info("master_dataset_cleared")

    def get_row_count(self) -> int:
        if not self.master_exists():
            return 0
        with _lock:
            conn = self._connect()
            try:
                result = conn.execute(
                    f"SELECT COUNT(*) FROM read_parquet('{self._escape_path(self.parquet_path)}')"
                ).fetchone()
                return int(result[0]) if result else 0
            finally:
                conn.close()

    def _escape_path(self, path: Path) -> str:
        return str(path).replace("\\", "/").replace("'", "''")

    def _empty_master_select_sql(self) -> str:
        """Build a zero-row SELECT with the full MASTER_DATASET column schema."""
        integer_cols = {"quarter", "year", "lead_age_days"}
        timestamp_cols = {"date", "ingested_at"}
        parts: List[str] = []
        for col in ALL_COLUMNS:
            if col in BOOLEAN_COLUMNS:
                parts.append(f"CAST(NULL AS BOOLEAN) AS {col}")
            elif col in NUMERIC_COLUMNS:
                parts.append(f"CAST(NULL AS DOUBLE) AS {col}")
            elif col in integer_cols:
                parts.append(f"CAST(NULL AS INTEGER) AS {col}")
            elif col in timestamp_cols:
                parts.append(f"CAST(NULL AS TIMESTAMP) AS {col}")
            else:
                parts.append(f"CAST(NULL AS VARCHAR) AS {col}")
        return f"SELECT {', '.join(parts)} WHERE 1=0"

    def _empty_block_payment_select_sql(self) -> str:
        parts = [f"CAST(NULL AS VARCHAR) AS {col}" for col in BLOCK_PAYMENT_COLUMNS]
        return f"SELECT {', '.join(parts)} WHERE 1=0"

    def _empty_persona_activity_select_sql(self) -> str:
        parts = [f"CAST(NULL AS VARCHAR) AS {col}" for col in PERSONA_ACTIVITY_COLUMNS]
        return f"SELECT {', '.join(parts)} WHERE 1=0"

    def register_block_payment_view(self, conn: duckdb.DuckDBPyConnection) -> None:
        if self.block_payment_exists():
            conn.execute(
                f"CREATE OR REPLACE VIEW {BLOCK_PAYMENT_TABLE} AS "
                f"SELECT * FROM read_parquet('{self._escape_path(self.block_payment_path)}')"
            )
        else:
            conn.execute(
                f"CREATE OR REPLACE VIEW {BLOCK_PAYMENT_TABLE} AS "
                f"{self._empty_block_payment_select_sql()}"
            )

    def register_persona_activity_view(self, conn: duckdb.DuckDBPyConnection) -> None:
        if self.persona_activity_exists():
            conn.execute(
                f"CREATE OR REPLACE VIEW {PERSONA_ACTIVITY_TABLE} AS "
                f"SELECT * FROM read_parquet('{self._escape_path(self.persona_activity_path)}')"
            )
        else:
            conn.execute(
                f"CREATE OR REPLACE VIEW {PERSONA_ACTIVITY_TABLE} AS "
                f"{self._empty_persona_activity_select_sql()}"
            )

    def register_master_view(self, conn: duckdb.DuckDBPyConnection) -> None:
        if self.master_exists():
            conn.execute(
                f"CREATE OR REPLACE VIEW {MASTER_DATASET_TABLE} AS "
                f"SELECT * FROM read_parquet('{self._escape_path(self.parquet_path)}')"
            )
        else:
            conn.execute(
                f"CREATE OR REPLACE VIEW {MASTER_DATASET_TABLE} AS "
                f"{self._empty_master_select_sql()}"
            )

    def execute_query(
        self,
        sql: str,
        params: Optional[List[Any]] = None,
    ) -> Tuple[List[str], List[Tuple[Any, ...]]]:
        with _lock:
            conn = self._connect()
            try:
                self.register_master_view(conn)
                self.register_block_payment_view(conn)
                self.register_persona_activity_view(conn)
                if params:
                    result = conn.execute(sql, params)
                else:
                    result = conn.execute(sql)
                columns = [desc[0] for desc in result.description]
                rows = result.fetchall()
                return columns, rows
            finally:
                conn.close()

    def execute_scalar(self, sql: str, params: Optional[List[Any]] = None) -> Any:
        columns, rows = self.execute_query(sql, params)
        if not rows:
            return None
        return rows[0][0]

    def query_dicts(self, sql: str, params: Optional[List[Any]] = None) -> List[Dict[str, Any]]:
        columns, rows = self.execute_query(sql, params)
        return [dict(zip(columns, row)) for row in rows]

    def get_master_columns(self) -> List[str]:
        """Column names available in MASTER_DATASET (empty view or parquet)."""
        try:
            columns, _ = self.execute_query(
                f"SELECT * FROM {MASTER_DATASET_TABLE} LIMIT 0"
            )
            return columns
        except Exception:
            return []

    def get_existing_prospect_ids(self) -> set:
        if not self.master_exists():
            return set()
        sql = f"SELECT DISTINCT prospect_id FROM {MASTER_DATASET_TABLE} WHERE prospect_id IS NOT NULL"
        rows = self.query_dicts(sql)
        return {str(r["prospect_id"]) for r in rows}

    def refresh_materialized_aggregates(self) -> None:
        """Create materialized aggregate tables for fast dashboard KPIs."""
        if not self.master_exists():
            return
        with _lock:
            conn = self._connect()
            try:
                self.register_master_view(conn)
                conn.execute(f"""
                    CREATE OR REPLACE TABLE mv_kpi_daily AS
                    SELECT
                        CAST(date AS DATE) AS dt,
                        COUNT(*) AS total_leads,
                        SUM(CASE WHEN connected THEN 1 ELSE 0 END) AS connected,
                        SUM(CASE WHEN contactability = 'Contactable' THEN 1 ELSE 0 END) AS contactable,
                        SUM(CASE WHEN LOWER(TRIM(COALESCE(last_activity, ''))) = 'lead capture' THEN 1 ELSE 0 END) AS never_dialed,
                        SUM(CASE WHEN mql THEN 1 ELSE 0 END) AS mql,
                        SUM(CASE WHEN sql THEN 1 ELSE 0 END) AS sql,
                        SUM(CASE WHEN application THEN 1 ELSE 0 END) AS applications,
                        SUM(CASE WHEN test_registration THEN 1 ELSE 0 END) AS test_registrations,
                        SUM(CASE WHEN offer_letter THEN 1 ELSE 0 END) AS offer_letters,
                        SUM(CASE WHEN admission THEN 1 ELSE 0 END) AS admissions,
                        COALESCE(SUM(revenue), 0) AS revenue,
                        COALESCE(SUM(partner_cost), 0) AS partner_cost,
                        SUM(CASE WHEN ai_contacted THEN 1 ELSE 0 END) AS ai_calls,
                        COALESCE(AVG(total_dialed_count), 0) AS avg_dial_count,
                        SUM(CASE WHEN dnp THEN 1 ELSE 0 END) AS dnp_count
                    FROM {MASTER_DATASET_TABLE}
                    WHERE date IS NOT NULL
                    GROUP BY CAST(date AS DATE)
                """)
                conn.execute(f"""
                    CREATE OR REPLACE TABLE mv_partner_summary AS
                    SELECT
                        partner,
                        COUNT(*) AS total_leads,
                        SUM(CASE WHEN connected THEN 1 ELSE 0 END) AS connected,
                        SUM(CASE WHEN admission THEN 1 ELSE 0 END) AS admissions,
                        SUM(CASE WHEN offer_letter THEN 1 ELSE 0 END) AS offer_letters,
                        SUM(CASE WHEN application THEN 1 ELSE 0 END) AS applications,
                        COALESCE(SUM(revenue), 0) AS revenue,
                        COALESCE(SUM(partner_cost), 0) AS partner_cost
                    FROM {MASTER_DATASET_TABLE}
                    WHERE partner IS NOT NULL
                    GROUP BY partner
                """)
                logger.info("materialized_views_refreshed")
            finally:
                conn.close()


class AnalyticsCache:
    """In-memory + SQLite cache for expensive analytics queries."""

    def __init__(self, ttl_seconds: int = 300):
        self.ttl_seconds = ttl_seconds
        self._memory: Dict[str, Tuple[datetime, Any]] = {}

    def _make_key(self, namespace: str, payload: Dict[str, Any]) -> str:
        raw = json.dumps(payload, sort_keys=True, default=str)
        digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return f"{namespace}:{digest}"

    def get(self, namespace: str, payload: Dict[str, Any]) -> Optional[Any]:
        key = self._make_key(namespace, payload)
        entry = self._memory.get(key)
        if entry and entry[0] > datetime.utcnow():
            return entry[1]
        return None

    def set(self, namespace: str, payload: Dict[str, Any], value: Any) -> None:
        key = self._make_key(namespace, payload)
        expires = datetime.utcnow() + timedelta(seconds=self.ttl_seconds)
        self._memory[key] = (expires, value)

    def invalidate_all(self) -> None:
        self._memory.clear()
