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
    ADMISSION_JOURNEY_BOOLEAN_COLUMNS,
    ADMISSION_JOURNEY_COLUMNS,
    ADMISSION_JOURNEY_META_FILE,
    ADMISSION_JOURNEY_PARQUET_FILE,
    ADMISSION_JOURNEY_TABLE,
    ADMISSIONS_COLUMNS,
    ADMISSIONS_LMS_COLUMNS,
    ADMISSIONS_LMS_META_FILE,
    ADMISSIONS_LMS_PARQUET_FILE,
    ADMISSIONS_LMS_TABLE,
    ADMISSIONS_META_FILE,
    ADMISSIONS_PARQUET_FILE,
    ADMISSIONS_TABLE,
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
    REFUND_COLUMNS,
    REFUND_META_FILE,
    REFUND_PARQUET_FILE,
    REFUND_TABLE,
)
from app.logging_config import get_logger

logger = get_logger(__name__)

_lock = threading.Lock()


class DuckDBRepository:
    """Repository for MASTER_DATASET analytics queries via DuckDB + Parquet."""

    def __init__(self, settings: Optional[Settings] = None, *, read_only: bool = False):
        self.settings = settings or get_settings()
        self.read_only = read_only
        self.parquet_path = self.settings.parquet_dir / MASTER_PARQUET_FILE
        self.block_payment_path = self.settings.parquet_dir / BLOCK_PAYMENT_PARQUET_FILE
        self.block_payment_meta_path = self.settings.parquet_dir / BLOCK_PAYMENT_META_FILE
        self.persona_activity_path = self.settings.parquet_dir / PERSONA_ACTIVITY_PARQUET_FILE
        self.persona_activity_meta_path = self.settings.parquet_dir / PERSONA_ACTIVITY_META_FILE
        self.refund_path = self.settings.parquet_dir / REFUND_PARQUET_FILE
        self.refund_meta_path = self.settings.parquet_dir / REFUND_META_FILE
        self.admissions_path = self.settings.parquet_dir / ADMISSIONS_PARQUET_FILE
        self.admissions_meta_path = self.settings.parquet_dir / ADMISSIONS_META_FILE
        self.admissions_lms_path = self.settings.parquet_dir / ADMISSIONS_LMS_PARQUET_FILE
        self.admissions_lms_meta_path = self.settings.parquet_dir / ADMISSIONS_LMS_META_FILE
        self.admission_journey_path = self.settings.parquet_dir / ADMISSION_JOURNEY_PARQUET_FILE
        self.admission_journey_meta_path = self.settings.parquet_dir / ADMISSION_JOURNEY_META_FILE
        self.duckdb_path = self.settings.duckdb_path
        self._conn: Optional[duckdb.DuckDBPyConnection] = None
        self._view_stamp: Optional[Tuple[float, ...]] = None
        self._row_count_cache: Optional[int] = None
        self._columns_cache: Optional[List[str]] = None

    def _connect(self) -> duckdb.DuckDBPyConnection:
        if self.read_only:
            # In-memory DB over Parquet — works while uvicorn locks analytics.duckdb.
            conn = duckdb.connect(":memory:")
        else:
            try:
                conn = duckdb.connect(str(self.duckdb_path))
            except Exception as exc:
                # Another uvicorn/--reload worker often holds an exclusive lock.
                # Fall back to in-memory parquet views so analytics still serve.
                msg = str(exc).lower()
                if "already open" in msg or "lock" in msg or "cannot open" in msg:
                    logger.warning(
                        "duckdb_locked_falling_back_readonly",
                        path=str(self.duckdb_path),
                        error=str(exc),
                    )
                    self.read_only = True
                    conn = duckdb.connect(":memory:")
                else:
                    raise
        conn.execute("SET threads TO 4")
        conn.execute("SET memory_limit = '4GB'")
        return conn

    def _file_mtime(self, path: Path) -> float:
        try:
            return path.stat().st_mtime if path.exists() else 0.0
        except OSError:
            return 0.0

    def _current_view_stamp(self) -> Tuple[float, ...]:
        return (
            self._file_mtime(self.parquet_path),
            self._file_mtime(self.block_payment_path),
            self._file_mtime(self.persona_activity_path),
            self._file_mtime(self.refund_path),
            self._file_mtime(self.admissions_path),
            self._file_mtime(self.admissions_lms_path),
            self._file_mtime(self.admission_journey_path),
        )

    def _get_conn(self) -> duckdb.DuckDBPyConnection:
        if self._conn is None:
            self._conn = self._connect()
        stamp = self._current_view_stamp()
        if stamp != self._view_stamp:
            self.register_master_view(self._conn)
            self.register_block_payment_view(self._conn)
            self.register_persona_activity_view(self._conn)
            self.register_refund_view(self._conn)
            self.register_admissions_view(self._conn)
            self.register_admissions_lms_view(self._conn)
            self.register_admission_journey_view(self._conn)
            self._view_stamp = stamp
            self._row_count_cache = None
            self._columns_cache = None
        return self._conn

    def invalidate_metadata_cache(self) -> None:
        self._row_count_cache = None
        self._columns_cache = None
        self._view_stamp = None

    def master_exists(self) -> bool:
        return self.parquet_path.exists()

    def block_payment_exists(self) -> bool:
        return self.block_payment_path.exists()

    def persona_activity_exists(self) -> bool:
        return self.persona_activity_path.exists()

    def refund_exists(self) -> bool:
        return self.refund_path.exists()

    def admissions_exists(self) -> bool:
        return self.admissions_path.exists()

    def admissions_lms_exists(self) -> bool:
        return self.admissions_lms_path.exists()

    def admission_journey_exists(self) -> bool:
        return self.admission_journey_path.exists()

    def _unlink_block_payment_files(self) -> None:
        if self.block_payment_path.exists():
            self.block_payment_path.unlink()
        if self.block_payment_meta_path.exists():
            self.block_payment_meta_path.unlink()
        self.invalidate_metadata_cache()

    def _unlink_persona_activity_files(self) -> None:
        if self.persona_activity_path.exists():
            self.persona_activity_path.unlink()
        if self.persona_activity_meta_path.exists():
            self.persona_activity_meta_path.unlink()
        self.invalidate_metadata_cache()

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
            conn = self._get_conn()
            try:
                conn.execute("DROP TABLE IF EXISTS mv_kpi_daily")
                conn.execute("DROP TABLE IF EXISTS mv_partner_summary")
            except Exception:
                pass
            self.invalidate_metadata_cache()
        logger.info("master_dataset_cleared")

    def get_row_count(self) -> int:
        if not self.master_exists():
            return 0
        if self._row_count_cache is not None:
            return self._row_count_cache
        with _lock:
            conn = self._get_conn()
            result = conn.execute(
                f"SELECT COUNT(*) FROM read_parquet('{self._escape_path(self.parquet_path)}')"
            ).fetchone()
            count = int(result[0]) if result else 0
            self._row_count_cache = count
            return count

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

    def _empty_refund_select_sql(self) -> str:
        parts: List[str] = []
        for col in REFUND_COLUMNS:
            if col == "is_refund":
                parts.append(f"CAST(NULL AS BOOLEAN) AS {col}")
            else:
                parts.append(f"CAST(NULL AS VARCHAR) AS {col}")
        return f"SELECT {', '.join(parts)} WHERE 1=0"

    def _empty_admissions_select_sql(self) -> str:
        parts: List[str] = []
        for col in ADMISSIONS_COLUMNS:
            if col == "is_paid":
                parts.append(f"CAST(NULL AS BOOLEAN) AS {col}")
            else:
                parts.append(f"CAST(NULL AS VARCHAR) AS {col}")
        return f"SELECT {', '.join(parts)} WHERE 1=0"

    def _empty_admissions_lms_select_sql(self) -> str:
        parts = [f"CAST(NULL AS VARCHAR) AS {col}" for col in ADMISSIONS_LMS_COLUMNS]
        return f"SELECT {', '.join(parts)} WHERE 1=0"

    def _empty_admission_journey_select_sql(self) -> str:
        parts: List[str] = []
        for col in ADMISSION_JOURNEY_COLUMNS:
            if col in ADMISSION_JOURNEY_BOOLEAN_COLUMNS:
                parts.append(f"CAST(NULL AS BOOLEAN) AS {col}")
            else:
                parts.append(f"CAST(NULL AS VARCHAR) AS {col}")
        return f"SELECT {', '.join(parts)} WHERE 1=0"

    def _parquet_column_names(
        self, conn: duckdb.DuckDBPyConnection, path: Path
    ) -> set:
        try:
            rows = conn.execute(
                f"DESCRIBE SELECT * FROM read_parquet('{self._escape_path(path)}')"
            ).fetchall()
            return {str(r[0]) for r in rows}
        except Exception:
            return set()

    def _select_sql_for_expected_columns(
        self,
        path: Path,
        expected: List[str],
        existing: set,
        boolean_cols: Optional[set] = None,
    ) -> str:
        """Project parquet to full expected schema; missing cols become NULL."""
        boolean_cols = boolean_cols or set()
        parts: List[str] = []
        for col in expected:
            if col in existing:
                if col in boolean_cols:
                    parts.append(f"CAST({col} AS BOOLEAN) AS {col}")
                else:
                    parts.append(f"CAST({col} AS VARCHAR) AS {col}")
            elif col in boolean_cols:
                parts.append(f"CAST(NULL AS BOOLEAN) AS {col}")
            else:
                parts.append(f"CAST(NULL AS VARCHAR) AS {col}")
        return (
            f"SELECT {', '.join(parts)} "
            f"FROM read_parquet('{self._escape_path(path)}')"
        )

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

    def register_refund_view(self, conn: duckdb.DuckDBPyConnection) -> None:
        if self.refund_exists():
            conn.execute(
                f"CREATE OR REPLACE VIEW {REFUND_TABLE} AS "
                f"SELECT * FROM read_parquet('{self._escape_path(self.refund_path)}')"
            )
        else:
            conn.execute(
                f"CREATE OR REPLACE VIEW {REFUND_TABLE} AS "
                f"{self._empty_refund_select_sql()}"
            )

    def register_admissions_view(self, conn: duckdb.DuckDBPyConnection) -> None:
        if self.admissions_exists():
            existing = self._parquet_column_names(conn, self.admissions_path)
            select_sql = self._select_sql_for_expected_columns(
                self.admissions_path,
                ADMISSIONS_COLUMNS,
                existing,
                boolean_cols={"is_paid"},
            )
            conn.execute(
                f"CREATE OR REPLACE VIEW {ADMISSIONS_TABLE} AS {select_sql}"
            )
        else:
            conn.execute(
                f"CREATE OR REPLACE VIEW {ADMISSIONS_TABLE} AS "
                f"{self._empty_admissions_select_sql()}"
            )

    def register_admissions_lms_view(self, conn: duckdb.DuckDBPyConnection) -> None:
        if self.admissions_lms_exists():
            existing = self._parquet_column_names(conn, self.admissions_lms_path)
            select_sql = self._select_sql_for_expected_columns(
                self.admissions_lms_path,
                ADMISSIONS_LMS_COLUMNS,
                existing,
            )
            conn.execute(
                f"CREATE OR REPLACE VIEW {ADMISSIONS_LMS_TABLE} AS {select_sql}"
            )
        else:
            conn.execute(
                f"CREATE OR REPLACE VIEW {ADMISSIONS_LMS_TABLE} AS "
                f"{self._empty_admissions_lms_select_sql()}"
            )

    def register_admission_journey_view(self, conn: duckdb.DuckDBPyConnection) -> None:
        if self.admission_journey_exists():
            existing = self._parquet_column_names(conn, self.admission_journey_path)
            select_sql = self._select_sql_for_expected_columns(
                self.admission_journey_path,
                ADMISSION_JOURNEY_COLUMNS,
                existing,
                boolean_cols=ADMISSION_JOURNEY_BOOLEAN_COLUMNS,
            )
            conn.execute(
                f"CREATE OR REPLACE VIEW {ADMISSION_JOURNEY_TABLE} AS {select_sql}"
            )
        else:
            conn.execute(
                f"CREATE OR REPLACE VIEW {ADMISSION_JOURNEY_TABLE} AS "
                f"{self._empty_admission_journey_select_sql()}"
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
            conn = self._get_conn()
            if params:
                result = conn.execute(sql, params)
            else:
                result = conn.execute(sql)
            columns = [desc[0] for desc in result.description]
            rows = result.fetchall()
            return columns, rows

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
        if self._columns_cache is not None:
            return self._columns_cache
        try:
            columns, _ = self.execute_query(
                f"SELECT * FROM {MASTER_DATASET_TABLE} LIMIT 0"
            )
            self._columns_cache = columns
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
            conn = self._get_conn()
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
            self.invalidate_metadata_cache()


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
