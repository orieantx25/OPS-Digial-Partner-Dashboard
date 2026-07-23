"""LeadSquared manual sync API routes."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.logging_config import get_logger
from app.services.job_store import job_store
from app.services.leadsquared_sync_service import LeadSquaredSyncService

router = APIRouter(prefix="/sync", tags=["sync"])
logger = get_logger(__name__)


class LeadSquaredSyncRequest(BaseModel):
    mode: str = Field(default="incremental", pattern="^(full|incremental)$")
    from_date: Optional[str] = Field(
        default=None,
        description="Optional UTC start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS) for full backfill",
    )


def _parse_from_date(value: Optional[str]) -> Optional[datetime]:
    if not value or not value.strip():
        return None
    raw = value.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="from_date must be YYYY-MM-DD or YYYY-MM-DD HH:MM:SS",
    )


def _require_sync_access(x_sync_token: Optional[str]) -> None:
    settings = get_settings()
    if not settings.leadsquared_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LeadSquared sync is not enabled on this server",
        )
    expected = settings.sync_admin_token.strip()
    if expected and (not x_sync_token or x_sync_token.strip() != expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing sync token",
        )


def _run_sync_job(
    job_id: str,
    mode: str,
    from_date: Optional[datetime],
) -> None:
    settings = get_settings()
    if not settings.leadsquared_configured:
        logger.error("lsq_sync_job_aborted_not_configured", job_id=job_id)
        job_store.update(
            job_id,
            status="failed",
            phase="Failed",
            error="LeadSquared sync is not enabled or credentials are missing",
            message="LeadSquared sync failed: not configured",
        )
        return

    def cb(percent: float, phase: str, rows_processed: int = 0, rows_total: int = 0) -> None:
        job_store.update(
            job_id,
            status="processing",
            percent=percent,
            phase=phase,
            rows_processed=rows_processed,
            rows_total=rows_total,
        )

    try:
        job_store.update(job_id, status="processing", phase="Starting", percent=0.0)
        service = LeadSquaredSyncService(settings=settings)
        result = service.run_sync(
            mode=mode,
            from_date=from_date,
            progress_cb=cb,
            run_id=job_id,
        )
        job_store.update(
            job_id,
            status="completed",
            percent=100.0,
            phase="Completed",
            rows_processed=int(result.get("master_total_rows") or 0),
            message=result.get("message", "Sync completed"),
            report=result,
        )
        logger.info("lsq_sync_job_done", job_id=job_id, mode=mode)
    except Exception as exc:
        logger.error("lsq_sync_job_failed", job_id=job_id, error=str(exc))
        job_store.update(
            job_id,
            status="failed",
            phase="Failed",
            error=str(exc),
            message=f"LeadSquared sync failed: {exc}",
        )


@router.get("/config")
async def sync_config():
    return LeadSquaredSyncService().get_public_config()


@router.get("/last-run")
async def sync_last_run():
    last = LeadSquaredSyncService().get_last_run()
    return last or {"status": "none"}


@router.post("/leadsquared")
async def start_leadsquared_sync(
    body: LeadSquaredSyncRequest,
    x_sync_token: Optional[str] = Header(default=None, alias="X-Sync-Token"),
):
    _require_sync_access(x_sync_token)
    from_dt = _parse_from_date(body.from_date)

    job_id = str(uuid.uuid4())
    job_store.create(job_id)
    logger.info("lsq_sync_started", job_id=job_id, mode=body.mode)

    thread = threading.Thread(
        target=_run_sync_job,
        args=(job_id, body.mode, from_dt),
        daemon=False,
        name=f"lsq-sync-{job_id[:8]}",
    )
    thread.start()
    return {"job_id": job_id, "status": "processing", "mode": body.mode}


@router.get("/status/{job_id}")
async def sync_status(job_id: str):
    job = job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync job not found")
    return job
