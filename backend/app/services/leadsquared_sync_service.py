"""Orchestrate LeadSquared manual sync into MASTER_DATASET and persona activity."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

import polars as pl

from app.config import Settings, get_settings
from app.infrastructure.database import LsqSyncRunRecord, get_session_factory
from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
from app.logging_config import get_logger
from app.services.ingestion_service import IngestionEngine
from app.services.leadsquared_client import LeadSquaredClient, LeadSquaredError
from app.services.leadsquared_mapper import (
    lead_include_csv,
    map_activities_to_dataframe,
    map_leads_to_dataframe,
)
from app.services.persona_activity_service import (
    PersonaActivityService,
    is_know_more_about_btech_event,
)

logger = get_logger(__name__)

FULL_SYNC_CHUNK_DAYS = 7
PERSONA_LOOKBACK_HOURS = 24
DEFAULT_FULL_SYNC_YEARS = 2


class LeadSquaredSyncService:
    def __init__(
        self,
        settings: Optional[Settings] = None,
        client: Optional[LeadSquaredClient] = None,
        ingestion: Optional[IngestionEngine] = None,
        persona: Optional[PersonaActivityService] = None,
        duck_repo: Optional[DuckDBRepository] = None,
        cache: Optional[AnalyticsCache] = None,
    ):
        self.settings = settings or get_settings()
        self.client = client or LeadSquaredClient(self.settings)
        self.ingestion = ingestion or IngestionEngine(self.settings)
        self.persona = persona or PersonaActivityService(settings=self.settings)
        self.duck_repo = duck_repo or DuckDBRepository(self.settings)
        self.cache = cache or AnalyticsCache(self.settings.analytics_cache_ttl_seconds)

    def get_public_config(self) -> Dict[str, Any]:
        return {
            "enabled": self.settings.leadsquared_configured,
            "api_host": self.settings.leadsquared_api_host,
            "requires_token": bool(self.settings.sync_admin_token.strip()),
            "page_size": self.settings.leadsquared_page_size,
            "sync_workers": self.settings.leadsquared_sync_workers,
        }

    def get_last_run(self) -> Optional[Dict[str, Any]]:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            record = (
                db.query(LsqSyncRunRecord)
                .order_by(LsqSyncRunRecord.started_at.desc())
                .first()
            )
            if not record:
                return None
            return {
                "id": record.id,
                "status": record.status,
                "mode": record.mode,
                "started_at": record.started_at.isoformat(),
                "completed_at": record.completed_at.isoformat() if record.completed_at else None,
                "leads_synced": record.leads_synced,
                "activities_synced": record.activities_synced,
                "master_total_rows": record.master_total_rows,
                "watermark_to": record.watermark_to.isoformat() if record.watermark_to else None,
                "message": record.message,
                "error": record.error,
            }
        finally:
            db.close()

    def _get_watermark(self) -> Optional[datetime]:
        last = self.get_last_run()
        if not last or last.get("status") != "completed":
            return None
        wm = last.get("watermark_to")
        if not wm:
            return None
        try:
            return datetime.fromisoformat(wm)
        except ValueError:
            return None

    def _persist_run(
        self,
        run_id: str,
        status: str,
        mode: str,
        started_at: datetime,
        completed_at: Optional[datetime],
        leads_synced: int,
        activities_synced: int,
        master_total_rows: int,
        watermark_to: Optional[datetime],
        message: str,
        error: Optional[str] = None,
    ) -> None:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            record = LsqSyncRunRecord(
                id=run_id,
                status=status,
                mode=mode,
                started_at=started_at,
                completed_at=completed_at,
                leads_synced=leads_synced,
                activities_synced=activities_synced,
                master_total_rows=master_total_rows,
                watermark_to=watermark_to,
                message=message,
                error=error,
            )
            db.add(record)
            db.commit()
        except Exception as exc:
            logger.error("lsq_sync_run_persist_failed", run_id=run_id, error=str(exc))
            db.rollback()
        finally:
            db.close()

    @staticmethod
    def _date_windows(
        from_date: datetime, to_date: datetime, chunk_days: int
    ) -> List[Tuple[datetime, datetime]]:
        windows: List[Tuple[datetime, datetime]] = []
        cursor = from_date
        delta = timedelta(days=chunk_days)
        while cursor < to_date:
            end = min(cursor + delta, to_date)
            windows.append((cursor, end))
            cursor = end
        return windows

    def backfill_block_amount_paid_leads(
        self,
        progress_cb: Optional[Callable[..., None]] = None,
        batch_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch all LSQ leads with ProspectStage=Block Amount Paid and upsert.

        CRM Contact Stage is ProspectStage; incremental RecentlyModified sync can
        leave contact_stage stale. This targeted lookup refreshes those rows.
        """
        run_id = batch_id or str(uuid.uuid4())

        def emit(percent: float, phase: str) -> None:
            if progress_cb:
                try:
                    progress_cb(percent=percent, phase=phase, rows_processed=0, rows_total=0)
                except Exception:
                    pass

        emit(0, "Fetching Block Amount Paid leads (ProspectStage)")
        include_csv = lead_include_csv()
        raw_leads = self.client.fetch_leads_by_lookup(
            lookup_name="ProspectStage",
            lookup_value="Block Amount Paid",
            include_csv=include_csv,
        )
        if not raw_leads:
            return {
                "rows_fetched": 0,
                "rows_accepted": 0,
                "message": "No ProspectStage=Block Amount Paid leads from LSQ",
            }

        mapped = map_leads_to_dataframe(raw_leads)
        emit(40, f"Ingesting {mapped.height} Block Amount Paid leads")
        ingest = self.ingestion.process_lsq_sync_batch(
            mapped,
            batch_id=f"{run_id}-bap",
            replace=False,
        )
        emit(80, "Recomputing block amount paid flags")
        block_stats = self.ingestion.recompute_block_amount_paid()
        self.cache.invalidate_all()
        by_partner = block_stats.get("block_paid_by_partner") or {}
        return {
            "rows_fetched": len(raw_leads),
            "rows_mapped": mapped.height,
            "rows_accepted": int(ingest.get("rows_accepted") or 0),
            "block_paid_after": block_stats.get("block_paid_after"),
            "block_paid_by_partner": by_partner,
            "message": (
                f"Backfilled {ingest.get('rows_accepted', 0)} Block Amount Paid leads; "
                f"flags after={block_stats.get('block_paid_after')}"
            ),
        }

    def _fetch_window_leads(
        self,
        win_from: datetime,
        win_to: datetime,
        include_csv: str,
        window_index: int,
    ) -> Tuple[int, pl.DataFrame]:
        """Fetch + map one date window. Uses a per-call client (thread-safe)."""
        client = LeadSquaredClient(self.settings)
        client.open()
        try:
            rows = client.fetch_leads_window(win_from, win_to, include_csv)
            df = map_leads_to_dataframe(rows) if rows else pl.DataFrame()
            return window_index, df
        finally:
            client.close()

    def run_sync(
        self,
        mode: str = "incremental",
        from_date: Optional[datetime] = None,
        progress_cb: Optional[Callable[..., None]] = None,
        run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self.settings.leadsquared_configured:
            raise LeadSquaredError("LeadSquared sync is not enabled or credentials are missing")

        run_id = run_id or str(uuid.uuid4())
        started_at = datetime.utcnow()
        to_date = datetime.utcnow()

        def emit(percent: float, phase: str, rows_processed: int = 0, rows_total: int = 0) -> None:
            if progress_cb:
                try:
                    progress_cb(
                        percent=round(min(99.0, max(0.0, percent)), 1),
                        phase=phase,
                        rows_processed=rows_processed,
                        rows_total=rows_total,
                    )
                except Exception:
                    pass

        replace = mode == "full"
        if replace:
            if from_date is None:
                from_date = to_date - timedelta(days=365 * DEFAULT_FULL_SYNC_YEARS)
        else:
            watermark = self._get_watermark()
            from_date = from_date or watermark or (to_date - timedelta(days=30))
            from_date = from_date - timedelta(hours=1)

        include_csv = lead_include_csv()
        windows = self._date_windows(from_date, to_date, FULL_SYNC_CHUNK_DAYS)
        n_windows = max(len(windows), 1)
        workers = min(self.settings.leadsquared_sync_workers, n_windows)

        emit(2, "Fetching leads from LeadSquared")
        self.client.open()
        try:
            # Parallel fetch all windows; ingest once at the end.
            by_index: Dict[int, pl.DataFrame] = {}
            fetched_rows = 0
            done_windows = 0

            def on_window_done(wi: int, df: pl.DataFrame) -> None:
                nonlocal fetched_rows, done_windows
                by_index[wi] = df
                fetched_rows += df.height
                done_windows += 1
                emit(
                    5 + 45 * (done_windows / n_windows),
                    "Fetching leads from LeadSquared",
                    fetched_rows,
                    fetched_rows,
                )

            if workers <= 1 or n_windows == 1:
                for wi, (win_from, win_to) in enumerate(windows):
                    idx, df = self._fetch_window_leads(win_from, win_to, include_csv, wi)
                    on_window_done(idx, df)
            else:
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    futures = {
                        pool.submit(
                            self._fetch_window_leads, win_from, win_to, include_csv, wi
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

            if lead_frames:
                raw_leads = (
                    pl.concat(lead_frames, how="diagonal_relaxed")
                    if len(lead_frames) > 1
                    else lead_frames[0]
                )
                emit(52, "Ingesting leads")
                leads_result = self.ingestion.process_lsq_sync_batch(
                    raw_leads,
                    batch_id=run_id,
                    replace=replace,
                    progress_cb=lambda p, ph, rp=0, rt=0: emit(
                        52 + p * 0.35, ph, rp, rt
                    ),
                )
            else:
                if replace:
                    self.duck_repo.clear_master()
                    self.cache.invalidate_all()
                else:
                    # Still purge Unknown / non-partners from existing master.
                    emit(52, "Purging non-partner rows")
                    self.ingestion.process_lsq_sync_batch(
                        pl.DataFrame(),
                        batch_id=run_id,
                        replace=False,
                    )
                leads_result = {
                    "rows_accepted": 0,
                    "rows_rejected": 0,
                    "message": "No leads fetched",
                }

            emit(88, "Fetching persona activities")
            act_from = to_date - timedelta(hours=PERSONA_LOOKBACK_HOURS)
            activity_pages: List[pl.DataFrame] = []
            for page in self.client.iter_recently_modified_activities(act_from, to_date):
                df = map_activities_to_dataframe(page)
                if df.height == 0:
                    continue
                if "notes" in df.columns:
                    df = df.filter(
                        pl.col("notes").map_elements(
                            is_know_more_about_btech_event,
                            return_dtype=pl.Boolean,
                        )
                    )
                else:
                    df = df.head(0)
                if df.height > 0:
                    activity_pages.append(df)

            persona_result = {"row_count": 0, "message": "No Know More about B.Tech activities in last 24h"}
            if activity_pages:
                raw_acts = (
                    pl.concat(activity_pages, how="diagonal_relaxed")
                    if len(activity_pages) > 1
                    else activity_pages[0]
                )
                persona_result = self.persona.write_dataframe(
                    raw_acts, source_label="leadsquared_sync"
                )
            else:
                # Clear any prior unfiltered sheet so Last 24h KPIs do not use stale rows.
                persona_result = self.persona.write_dataframe(
                    pl.DataFrame(
                        {
                            c: pl.Series(c, [], dtype=pl.Utf8)
                            for c in (
                                "prospect_id",
                                "email",
                                "phone",
                                "contact_name",
                                "activity_id",
                                "activity_date",
                                "activity_modified_on",
                                "notes",
                                "match_email",
                                "uploaded_at",
                                "source_filename",
                            )
                        }
                    ),
                    source_label="leadsquared_sync",
                )
                persona_result["message"] = (
                    "No Know More about B.Tech activities in last 24h"
                )
            self.cache.invalidate_all()

            emit(90, "Backfilling Block Amount Paid (ProspectStage)")
            bap_backfill = self.backfill_block_amount_paid_leads(
                progress_cb=lambda p, ph, rp=0, rt=0: emit(
                    90 + min(8.0, float(p) * 0.08), ph
                ),
                batch_id=run_id,
            )
            block_stats = {
                "block_paid_by_partner": bap_backfill.get("block_paid_by_partner") or {},
                "block_paid_after": bap_backfill.get("block_paid_after"),
            }

            master_total = self.duck_repo.get_row_count()
            partner_bits = ", ".join(
                f"{p}={n}"
                for p, n in sorted(
                    (block_stats.get("block_paid_by_partner") or {}).items()
                )
            )
            message = (
                f"LeadSquared sync complete — {leads_result.get('rows_accepted', 0)} leads, "
                f"{persona_result.get('row_count', 0)} activities"
            )
            if bap_backfill.get("rows_fetched"):
                message += (
                    f"; BAP backfill fetched={bap_backfill.get('rows_fetched')} "
                    f"accepted={bap_backfill.get('rows_accepted')}"
                )
            if partner_bits:
                message += f"; block paid by partner: {partner_bits}"
            completed_at = datetime.utcnow()
            self._persist_run(
                run_id=run_id,
                status="completed",
                mode=mode,
                started_at=started_at,
                completed_at=completed_at,
                leads_synced=int(leads_result.get("rows_accepted") or 0),
                activities_synced=int(persona_result.get("row_count") or 0),
                master_total_rows=master_total,
                watermark_to=to_date,
                message=message,
            )
            emit(100, "Completed", master_total, master_total)
            return {
                "run_id": run_id,
                "status": "completed",
                "mode": mode,
                "leads_synced": leads_result.get("rows_accepted", 0),
                "activities_synced": persona_result.get("row_count", 0),
                "master_total_rows": master_total,
                "block_paid_by_partner": block_stats.get("block_paid_by_partner") or {},
                "message": message,
            }
        except Exception as exc:
            logger.error("lsq_sync_failed", run_id=run_id, error=str(exc))
            self._persist_run(
                run_id=run_id,
                status="failed",
                mode=mode,
                started_at=started_at,
                completed_at=datetime.utcnow(),
                leads_synced=0,
                activities_synced=0,
                master_total_rows=self.duck_repo.get_row_count(),
                watermark_to=None,
                message="LeadSquared sync failed",
                error=str(exc),
            )
            raise
        finally:
            self.client.close()
