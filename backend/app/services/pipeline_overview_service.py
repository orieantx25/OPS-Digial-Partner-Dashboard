"""Isolated LSQ pipeline overview for the admission-journey portal.

Uses a dedicated full-CRM parquet (every LeadSquared lead, any source).
Never reads or writes MASTER_DATASET and never changes journey clash logic.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import polars as pl

from app.config import Settings, get_settings
from app.domain.schema import (
    ADMISSIONS_LMS_TABLE,
    PIPELINE_CRM_COLUMNS,
    PIPELINE_CRM_META_FILE,
    PIPELINE_CRM_PARQUET_FILE,
    stage_to_funnel,
)
from app.infrastructure.duckdb_repo import DuckDBRepository
from app.logging_config import get_logger

logger = get_logger(__name__)

# Ordered LSQ-native steps for this overview only. Later steps include earlier ones.
PIPELINE_STEPS: List[Tuple[str, str]] = [
    ("lead", "Lead"),
    ("connected", "Connected"),
    ("mql", "MQL"),
    ("sql", "SQL"),
    ("ugnet_form", "UGNET form filled"),
    ("test_fee_paid", "Test fee paid"),
    ("ugnet_appeared", "UGNET appeared"),
    ("shortlisted", "Shortlisted for interview"),
    ("interview", "Interview"),
    ("offer", "Offer letter"),
    ("block", "Block amount paid"),
    ("admission", "Admission"),
]

PIPELINE_RANK: Dict[str, int] = {key: i + 1 for i, (key, _label) in enumerate(PIPELINE_STEPS)}
PIPELINE_LABEL: Dict[str, str] = {key: label for key, label in PIPELINE_STEPS}

# LSQ labels that roll up into MQL / SQL. Shown as nested stops; side totals stay on the parent.
MQL_SUBSTAGES: List[str] = [
    "Sign Up",
    "Counseled",
    "Follow up (post-counsel)",
    "AI Bot Sent - Brochure",
    "AI Bot Sent - Payment Link",
    "AI Bot Qualified - Warm",
    "AI Bot Qualified - Hot",
    "AI Bot Qualified - High Intent",
]
SQL_SUBSTAGES: List[str] = [
    "Profile Completed",
    "Comprehensive Profile Completed",
]
_PARENT_SUBSTAGES: Dict[str, List[str]] = {
    "mql": MQL_SUBSTAGES,
    "sql": SQL_SUBSTAGES,
}

_LMS_SEM1_SQL = (
    "(TRIM(COALESCE(CAST(semester AS VARCHAR), '')) IN ('1', '1.0', 'Sem 1', 'Semester 1', '') "
    "OR LOWER(TRIM(COALESCE(CAST(semester AS VARCHAR), ''))) LIKE '%sem%1%' "
    "OR LOWER(TRIM(COALESCE(CAST(semester AS VARCHAR), ''))) = 'i')"
)

_CANON_FLOOR: Dict[str, str] = {
    "Lead": "lead",
    "Connected": "connected",
    "MQL": "mql",
    "SQL": "sql",
    "Application": "ugnet_form",
    "Test Registration": "test_fee_paid",
    "Interview": "shortlisted",
    "Offer Letter": "offer",
    "Block Amount Paid": "block",
    "Admission": "admission",
}

_EXACT_LABEL: Dict[str, str] = {
    "ugnet form filled": "ugnet_form",
    "ugnet fee paid": "test_fee_paid",
    "test fee paid": "test_fee_paid",
    "test registration": "test_fee_paid",
    "ugnet scheduled": "ugnet_appeared",
    "ugnet appeared": "ugnet_appeared",
    "appeared for ugnet": "ugnet_appeared",
    "ugnet not qualified": "ugnet_appeared",
    "shortlisted for interview": "shortlisted",
    "interview scheduled": "interview",
    "interview incomplete": "interview",
    "interview completed": "interview",
    "interview qualified": "interview",
    "offer letter released": "offer",
    "provisional ol sent": "offer",
    "block amount paid": "block",
    "admission": "admission",
    "admitted": "admission",
    "enrolled": "admission",
}

_FUZZY: List[Tuple[List[str], str]] = [
    (["admission"], "admission"),
    (["admitted"], "admission"),
    (["enrolled"], "admission"),
    (["block", "amount"], "block"),
    (["offer"], "offer"),
    (["provisional", "ol"], "offer"),
    (["interview", "qualif"], "interview"),
    (["interview", "complete"], "interview"),
    (["interview", "schedul"], "interview"),
    (["shortlisted"], "shortlisted"),
    (["interview"], "interview"),
    (["appeared"], "ugnet_appeared"),
    (["ugnet", "schedul"], "ugnet_appeared"),
    (["test", "fee"], "test_fee_paid"),
    (["ugnet", "fee"], "test_fee_paid"),
    (["form", "filled"], "ugnet_form"),
    (["profile", "completed"], "sql"),
    (["sign up"], "mql"),
    (["counsel"], "mql"),
]


def _norm(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def merge_substages(parent_key: str, observed: Dict[str, int]) -> List[Dict[str, Any]]:
    """Canonical MQL/SQL members plus any extra live LSQ labels for that parent."""
    names = list(_PARENT_SUBSTAGES.get(parent_key) or [])
    if not names and not observed:
        return []
    seen = {_norm(name) for name in names}
    extras: List[str] = []
    for label in sorted(observed.keys(), key=lambda item: (-observed[item], item.lower())):
        key = _norm(label)
        if key and key not in seen:
            extras.append(label)
            seen.add(key)
    observed_by_norm = {_norm(label): (label, count) for label, count in observed.items()}
    rows: List[Dict[str, Any]] = []
    for name in names + extras:
        live = observed_by_norm.get(_norm(name))
        rows.append(
            {
                "label": live[0] if live else name,
                "count": int(live[1]) if live else 0,
            }
        )
    return rows


def map_lsq_label(value: Any) -> str:
    """Map a raw LSQ contact/lead stage onto this overview's ordered steps."""
    key = _norm(value)
    if not key:
        return "lead"
    if key in _EXACT_LABEL:
        return _EXACT_LABEL[key]
    for parts, step in _FUZZY:
        if all(part in key for part in parts):
            return step
    return _CANON_FLOOR.get(stage_to_funnel(value), "lead")


def furthest_pipeline_key(
    contact_stage: Any = None,
    lead_stage: Any = None,
    flags: Optional[Dict[str, bool]] = None,
) -> str:
    rank = PIPELINE_RANK[map_lsq_label(contact_stage)]
    rank = max(rank, PIPELINE_RANK[map_lsq_label(lead_stage)])
    flags = flags or {}
    flag_floor = [
        ("connected", "connected"),
        ("mql", "mql"),
        ("sql", "sql"),
        ("application", "ugnet_form"),
        ("test_registration", "test_fee_paid"),
        ("interview", "shortlisted"),
        ("offer_letter", "offer"),
        ("block_amount_paid", "block"),
        ("admission", "admission"),
    ]
    for col, step in flag_floor:
        if flags.get(col):
            rank = max(rank, PIPELINE_RANK[step])
    for key, step_rank in PIPELINE_RANK.items():
        if step_rank == rank:
            return key
    return "lead"


def _escape_parquet_path(path: Path) -> str:
    return str(path).replace("\\", "/").replace("'", "''")


def slim_crm_leads(frame: Optional[pl.DataFrame]) -> pl.DataFrame:
    """Keep prospect id + live LSQ stages only. No partner filter."""
    empty = pl.DataFrame(
        {
            "prospect_id": pl.Series([], dtype=pl.Utf8),
            "contact_stage": pl.Series([], dtype=pl.Utf8),
            "lead_stage": pl.Series([], dtype=pl.Utf8),
        }
    )
    if frame is None or frame.height == 0:
        return empty
    work = frame
    for col in PIPELINE_CRM_COLUMNS:
        if col not in work.columns:
            work = work.with_columns(pl.lit(None).cast(pl.Utf8).alias(col))
    slim = work.select(
        [
            pl.col("prospect_id").cast(pl.Utf8, strict=False).str.strip_chars(),
            pl.col("contact_stage").cast(pl.Utf8, strict=False),
            pl.col("lead_stage").cast(pl.Utf8, strict=False),
        ]
    )
    slim = slim.filter(
        pl.col("prospect_id").is_not_null() & (pl.col("prospect_id") != "")
    )
    if slim.height == 0:
        return empty
    return slim.unique(subset=["prospect_id"], keep="last")


class PipelineOverviewService:
    def __init__(
        self,
        duck_repo: Optional[DuckDBRepository] = None,
        settings: Optional[Settings] = None,
    ):
        self.settings = settings or get_settings()
        self.duck_repo = duck_repo or DuckDBRepository(self.settings)
        self.parquet_path = self.settings.parquet_dir / PIPELINE_CRM_PARQUET_FILE
        self.meta_path = self.settings.parquet_dir / PIPELINE_CRM_META_FILE

    def store_exists(self) -> bool:
        return self.parquet_path.exists()

    def ingest_unfiltered_leads(
        self,
        frame: Optional[pl.DataFrame],
        *,
        replace: bool = False,
        only_if_exists: bool = False,
    ) -> Dict[str, Any]:
        """Write every mapped LSQ lead into the isolated CRM pipeline store.

        Does not touch MASTER_DATASET or admission_journey.parquet.
        """
        if only_if_exists and not replace and not self.store_exists():
            return {"rows_written": 0, "skipped": True}
        incoming = slim_crm_leads(frame)
        if replace and incoming.height == 0 and self.store_exists():
            meta = self._read_meta()
            return {
                "rows_written": int(meta.get("row_count") or 0),
                "skipped": True,
                "reason": "empty_fetch",
                **meta,
            }
        if not replace and self.store_exists():
            existing = pl.read_parquet(self.parquet_path)
            incoming = slim_crm_leads(
                pl.concat([existing, incoming], how="diagonal_relaxed")
                if incoming.height
                else existing
            )
        self.settings.parquet_dir.mkdir(parents=True, exist_ok=True)
        incoming.write_parquet(self.parquet_path)
        meta = {
            "row_count": incoming.height,
            "last_synced_at": datetime.utcnow().isoformat(),
            "source": "all_crm",
            "replace": replace,
        }
        self.meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return {"rows_written": incoming.height, "skipped": False, **meta}

    def sync_from_lsq(
        self,
        progress: Optional[Callable[..., None]] = None,
    ) -> Dict[str, Any]:
        """Fetch all CRM leads from LeadSquared. Never writes MASTER_DATASET."""
        from app.services.leadsquared_client import LeadSquaredError
        from app.services.leadsquared_mapper import lead_include_csv
        from app.services.leadsquared_sync_service import (
            DEFAULT_FULL_SYNC_YEARS,
            FULL_SYNC_CHUNK_DAYS,
            LeadSquaredSyncService,
        )

        if not self.settings.leadsquared_configured:
            raise LeadSquaredError(
                "LeadSquared sync is not enabled or credentials are missing"
            )

        def emit(percent: float, phase: str, rows_processed: int = 0) -> None:
            if progress:
                try:
                    progress(
                        percent=round(min(99.0, max(0.0, percent)), 1),
                        phase=phase,
                        rows_processed=rows_processed,
                        rows_total=rows_processed,
                        message=phase,
                    )
                except Exception:
                    pass

        lsq = LeadSquaredSyncService(
            settings=self.settings,
            duck_repo=self.duck_repo,
        )
        to_date = datetime.utcnow()
        from_date = to_date - timedelta(days=365 * DEFAULT_FULL_SYNC_YEARS)
        include_csv = lead_include_csv()
        windows = lsq._date_windows(from_date, to_date, FULL_SYNC_CHUNK_DAYS)
        n_windows = max(len(windows), 1)
        workers = min(self.settings.leadsquared_sync_workers, n_windows)

        emit(2, "Fetching all CRM leads from LeadSquared")
        by_index: Dict[int, pl.DataFrame] = {}
        fetched_rows = 0
        done_windows = 0

        def on_window_done(wi: int, df: pl.DataFrame) -> None:
            nonlocal fetched_rows, done_windows
            by_index[wi] = df
            fetched_rows += df.height
            done_windows += 1
            emit(
                5 + 80 * (done_windows / n_windows),
                "Fetching all CRM leads from LeadSquared",
                fetched_rows,
            )

        if workers <= 1 or n_windows == 1:
            for wi, (win_from, win_to) in enumerate(windows):
                idx, df = lsq._fetch_window_leads(win_from, win_to, include_csv, wi)
                on_window_done(idx, df)
        else:
            from concurrent.futures import ThreadPoolExecutor, as_completed

            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {
                    pool.submit(
                        lsq._fetch_window_leads, win_from, win_to, include_csv, wi
                    ): wi
                    for wi, (win_from, win_to) in enumerate(windows)
                }
                for fut in as_completed(futures):
                    wi, df = fut.result()
                    on_window_done(wi, df)

        lead_frames = [
            by_index[i]
            for i in range(n_windows)
            if i in by_index and by_index[i].height > 0
        ]
        raw = (
            pl.concat(lead_frames, how="diagonal_relaxed")
            if len(lead_frames) > 1
            else (lead_frames[0] if lead_frames else None)
        )
        emit(90, "Writing full CRM pipeline snapshot", fetched_rows)
        written = self.ingest_unfiltered_leads(raw, replace=True)
        emit(100, "Completed", int(written.get("rows_written") or 0))
        return {
            "status": "completed",
            "rows_fetched": fetched_rows,
            "rows_written": int(written.get("rows_written") or 0),
            "last_synced_at": written.get("last_synced_at"),
            "message": (
                f"Loaded {written.get('rows_written', 0)} CRM leads into the "
                "pipeline overview (all sources, not digital partners only)."
            ),
        }

    def get_overview(self) -> Dict[str, Any]:
        meta = self._read_meta()
        if not self.store_exists():
            return self._empty(lsq_loaded=False, last_synced_at=None)
        try:
            src = _escape_parquet_path(self.parquet_path)
            groups = self.duck_repo.query_dicts(
                f"""
                SELECT contact_stage, lead_stage, COUNT(*) AS cnt
                FROM read_parquet('{src}')
                GROUP BY 1, 2
                """
            )
        except Exception as exc:
            logger.warning("pipeline_overview_query_failed", error=str(exc))
            return self._empty(lsq_loaded=True, last_synced_at=meta.get("last_synced_at"))

        cumulative = {key: 0 for key, _ in PIPELINE_STEPS}
        exclusive = {key: 0 for key, _ in PIPELINE_STEPS}
        observed: Dict[str, Dict[str, int]] = {key: {} for key, _ in PIPELINE_STEPS}
        total = 0
        for group in groups:
            count = int(group.get("cnt") or 0)
            if count <= 0:
                continue
            total += count
            contact = group.get("contact_stage")
            lead = group.get("lead_stage")
            furthest = furthest_pipeline_key(contact, lead)
            furthest_rank = PIPELINE_RANK[furthest]
            exclusive[furthest] += count
            for key, step_rank in PIPELINE_RANK.items():
                if furthest_rank >= step_rank:
                    cumulative[key] += count
            for raw in (contact, lead):
                label = str(raw or "").strip()
                if not label:
                    continue
                step = map_lsq_label(label)
                observed[step][label] = observed[step].get(label, 0) + count

        steps = []
        prev_count: Optional[int] = None
        lms_count, lms_loaded = self._lms_admission_count()
        for key, label in PIPELINE_STEPS:
            reached = lms_count if key == "admission" else cumulative[key]
            conversion = None
            if prev_count and prev_count > 0:
                conversion = round(100.0 * reached / prev_count, 2)
            step = {
                "key": key,
                "label": label,
                "reached": reached,
                "at_stage": exclusive[key] if key != "admission" else reached,
                "conversion_from_previous_pct": conversion,
                "substages": merge_substages(key, observed.get(key) or {}),
                "lsq_labels": [
                    {"label": name, "count": cnt}
                    for name, cnt in sorted(
                        observed[key].items(), key=lambda item: (-item[1], item[0])
                    )[:12]
                ],
            }
            if key == "admission":
                step["source"] = "lms"
            steps.append(step)
            prev_count = reached

        last_synced = meta.get("last_synced_at")
        return {
            "has_data": total > 0,
            "lsq_loaded": True,
            "lms_loaded": lms_loaded,
            "total_leads": total,
            "admissions": lms_count,
            "last_synced_at": last_synced,
            "source": "all_crm",
            "steps": steps,
        }

    def _lms_admission_count(self) -> Tuple[int, bool]:
        """Verified Sem 1 LMS sheet rows. Isolated read — does not write LMS or master."""
        if not self.duck_repo.admissions_lms_exists():
            return 0, False
        try:
            value = self.duck_repo.execute_scalar(
                f"""
                SELECT COUNT(*) AS cnt
                FROM {ADMISSIONS_LMS_TABLE}
                WHERE LOWER(TRIM(COALESCE(status, ''))) = 'verified'
                  AND {_LMS_SEM1_SQL}
                """
            )
            return int(value or 0), True
        except Exception as exc:
            logger.warning("pipeline_lms_admission_count_failed", error=str(exc))
            return 0, True

    def _read_meta(self) -> Dict[str, Any]:
        if not self.meta_path.exists():
            return {}
        try:
            return json.loads(self.meta_path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _empty(
        self,
        lsq_loaded: bool,
        last_synced_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        return {
            "has_data": False,
            "lsq_loaded": lsq_loaded,
            "lms_loaded": False,
            "total_leads": 0,
            "admissions": 0,
            "last_synced_at": last_synced_at,
            "source": "all_crm",
            "steps": [
                {
                    "key": key,
                    "label": label,
                    "reached": 0,
                    "at_stage": 0,
                    "conversion_from_previous_pct": None,
                    "substages": merge_substages(key, {}),
                    "lsq_labels": [],
                }
                for key, label in PIPELINE_STEPS
            ],
        }
