"""Isolated admission-journey portal APIs. Does not write MASTER_DATASET."""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import require_authenticated_user, require_write_access
from app.config import get_settings
from app.domain.models import PaginatedResponse, UserInfo
from app.logging_config import get_logger
from app.services.admission_journey_service import AdmissionJourneyService
from app.services.job_store import job_store
from app.services.leadership_deploy_service import deploy_leadership_snapshots
from app.services.pipeline_overview_service import PipelineOverviewService

router = APIRouter(prefix="/admission-journey", tags=["admission-journey"])
logger = get_logger(__name__)

_active_job_lock = threading.Lock()
_active_job_id: Optional[str] = None
# Hung sync (e.g. stuck deploy) must not block Sync forever.
_STALE_JOB_SECONDS = 20 * 60


def get_journey_service() -> AdmissionJourneyService:
    return AdmissionJourneyService()


def _current_job() -> Optional[Dict[str, Any]]:
    with _active_job_lock:
        job_id = _active_job_id
    if not job_id:
        return None
    return job_store.get(job_id)


def _clear_stale_active_job() -> None:
    """Mark stalled sync jobs failed so a new Sync can start."""
    global _active_job_id
    with _active_job_lock:
        job_id = _active_job_id
        if not job_id:
            return
        job = job_store.get(job_id)
        if not job:
            _active_job_id = None
            return
        if job.get("status") not in {"queued", "processing"}:
            _active_job_id = None
            return
        updated_at = float(job.get("updated_at") or job.get("created_at") or 0)
        age = time.time() - updated_at
        if age < _STALE_JOB_SECONDS:
            return
        job_store.update(
            job_id,
            status="failed",
            phase="Timed out",
            error=f"Sync stalled for {int(age // 60)} minutes and was cancelled",
            message=f"Sync stalled for {int(age // 60)} minutes and was cancelled",
        )
        _active_job_id = None
        logger.warning(
            "admission_journey_sync_stale_cleared", job_id=job_id, age_sec=int(age)
        )


def _run_sync_job(job_id: str, service: AdmissionJourneyService) -> None:
    global _active_job_id

    def progress(payload: Dict[str, Any]) -> None:
        job_store.update(
            job_id,
            status="processing",
            phase=str(payload.get("message") or "Syncing"),
            percent=_percent(payload),
            rows_total=int(payload.get("total") or 0),
            rows_processed=int(payload.get("synced") or 0),
            message=str(payload.get("message") or ""),
            report={
                "synced": payload.get("synced"),
                "total": payload.get("total"),
                "failed": payload.get("failed"),
                "unmatched_lsq": payload.get("unmatched_lsq"),
            },
        )

    try:
        job_store.update(job_id, status="processing", phase="Starting", percent=0.0)
        result = service.sync(progress=progress)
        message = result.get("message") or "Completed"
        report: Dict[str, Any] = dict(result)

        job_store.update(
            job_id,
            status="processing",
            phase="Journey sync complete",
            percent=95.0,
            rows_total=int(result.get("total") or 0),
            rows_processed=int(result.get("synced") or 0),
            message=message,
            report=report,
        )

        settings = get_settings()
        if settings.leadership_auto_deploy_on_sync:
            def deploy_cb(percent: float, phase: str) -> None:
                job_store.update(job_id, status="processing", percent=percent, phase=phase)

            try:
                deploy_info = deploy_leadership_snapshots(progress_cb=deploy_cb)
                report["leadership_deploy"] = deploy_info
                deploy_msg = deploy_info.get("message") or "Leadership deploy complete"
                message = f"{message}; {deploy_msg}"
            except Exception as deploy_exc:
                logger.error(
                    "admission_journey_deploy_failed", job_id=job_id, error=str(deploy_exc)
                )
                message = f"{message}; Deploy failed: {deploy_exc}"

        job_store.update(
            job_id,
            status="completed",
            phase="Completed",
            percent=100.0,
            rows_total=int(result.get("total") or 0),
            rows_processed=int(result.get("synced") or 0),
            message=message,
            report=report,
        )
    except Exception as exc:
        logger.error("admission_journey_sync_failed", job_id=job_id, error=str(exc))
        job_store.update(
            job_id,
            status="failed",
            phase="Failed",
            error=str(exc),
            message=str(exc),
        )
    finally:
        with _active_job_lock:
            if _active_job_id == job_id:
                _active_job_id = None


def _percent(payload: Dict[str, Any]) -> float:
    total = float(payload.get("total") or 0)
    synced = float(payload.get("synced") or 0)
    if total <= 0:
        return 0.0
    return min(95.0, round(100.0 * synced / total, 1))


@router.get("/status")
async def journey_status(
    service: AdmissionJourneyService = Depends(get_journey_service),
    user: UserInfo = Depends(require_authenticated_user),
):
    _clear_stale_active_job()
    payload = service.get_status()
    payload["sync_job"] = _current_job()
    return payload


@router.post("/sync")
async def start_journey_sync(
    service: AdmissionJourneyService = Depends(get_journey_service),
    user: UserInfo = Depends(require_write_access),
):
    global _active_job_id
    status_payload = service.get_status()
    if not status_payload.get("admissions_loaded"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All Payments sheet is not loaded. Run Google/admissions sync first.",
        )

    _clear_stale_active_job()

    with _active_job_lock:
        if _active_job_id and (job_store.get(_active_job_id) or {}).get("status") in {
            "queued",
            "processing",
        }:
            return {"job_id": _active_job_id, "status": "already_running"}
        job_id = str(uuid.uuid4())
        _active_job_id = job_id
        job_store.create(job_id)

    thread = threading.Thread(
        target=_run_sync_job,
        args=(job_id, service),
        daemon=True,
        name=f"admission-journey-sync-{job_id[:8]}",
    )
    thread.start()
    logger.info("admission_journey_sync_started", user=user.username, job_id=job_id)
    return {"job_id": job_id, "status": "queued"}


@router.get("/sync/{job_id}")
async def journey_sync_job(
    job_id: str,
    user: UserInfo = Depends(require_authenticated_user),
):
    job = job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync job not found")
    return job


@router.get("/students")
async def list_students(
    campus: Optional[str] = Query(default=None),
    clash: Optional[str] = Query(default=None),
    paid: Optional[str] = Query(default=None),
    channel: Optional[str] = Query(default="all"),
    block_status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    service: AdmissionJourneyService = Depends(get_journey_service),
    user: UserInfo = Depends(require_authenticated_user),
) -> PaginatedResponse:
    return PaginatedResponse(
        **service.list_students(
            campus=campus,
            clash=clash,
            paid=paid,
            channel=channel,
            block_status=block_status,
            search=search,
            page=page,
            page_size=page_size,
        )
    )


@router.get("/export")
async def export_students(
    campus: Optional[str] = Query(default=None),
    clash: Optional[str] = Query(default=None),
    paid: Optional[str] = Query(default=None),
    channel: Optional[str] = Query(default="all"),
    block_status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    service: AdmissionJourneyService = Depends(get_journey_service),
    user: UserInfo = Depends(require_authenticated_user),
):
    try:
        csv_text = service.export_students_csv(
            campus=campus,
            clash=clash,
            paid=paid,
            channel=channel,
            block_status=block_status,
            search=search,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=admission_journey.csv"},
    )


@router.get("/students/{journey_id}")
async def student_detail(
    journey_id: str,
    service: AdmissionJourneyService = Depends(get_journey_service),
    user: UserInfo = Depends(require_authenticated_user),
):
    detail = service.get_student(journey_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    return detail

_pipeline_job_lock = threading.Lock()
_pipeline_job_id: Optional[str] = None


def _current_pipeline_job() -> Optional[Dict[str, Any]]:
    with _pipeline_job_lock:
        job_id = _pipeline_job_id
    if not job_id:
        return None
    return job_store.get(job_id)


def _run_pipeline_sync_job(job_id: str, service: PipelineOverviewService) -> None:
    global _pipeline_job_id

    def progress(**payload: Any) -> None:
        job_store.update(
            job_id,
            status="processing",
            phase=str(payload.get("phase") or payload.get("message") or "Syncing"),
            percent=float(payload.get("percent") or 0),
            rows_total=int(payload.get("rows_total") or payload.get("rows_processed") or 0),
            rows_processed=int(payload.get("rows_processed") or 0),
            message=str(payload.get("message") or payload.get("phase") or ""),
        )

    try:
        result = service.sync_from_lsq(progress=progress)
        job_store.update(
            job_id,
            status="completed",
            phase="Completed",
            percent=100.0,
            rows_total=int(result.get("rows_written") or 0),
            rows_processed=int(result.get("rows_written") or 0),
            message=result.get("message") or "Completed",
            report=result,
        )
    except Exception as exc:
        logger.error("pipeline_crm_sync_failed", job_id=job_id, error=str(exc))
        job_store.update(
            job_id,
            status="failed",
            phase="Failed",
            error=str(exc),
            message=str(exc),
        )
    finally:
        with _pipeline_job_lock:
            if _pipeline_job_id == job_id:
                _pipeline_job_id = None


@router.get("/pipeline-overview")
async def pipeline_overview(
    user: UserInfo = Depends(require_authenticated_user),
):
    payload = PipelineOverviewService().get_overview()
    payload["sync_job"] = _current_pipeline_job()
    return payload


@router.post("/pipeline-overview/sync")
async def start_pipeline_overview_sync(
    user: UserInfo = Depends(require_write_access),
):
    global _pipeline_job_id
    with _pipeline_job_lock:
        if _pipeline_job_id and (job_store.get(_pipeline_job_id) or {}).get("status") in {
            "queued",
            "processing",
        }:
            return {"job_id": _pipeline_job_id, "status": "already_running"}
        job_id = str(uuid.uuid4())
        _pipeline_job_id = job_id
        job_store.create(job_id)

    thread = threading.Thread(
        target=_run_pipeline_sync_job,
        args=(job_id, PipelineOverviewService()),
        daemon=True,
        name=f"pipeline-crm-sync-{job_id[:8]}",
    )
    thread.start()
    logger.info("pipeline_crm_sync_started", user=user.username, job_id=job_id)
    return {"job_id": job_id, "status": "queued"}


@router.get("/pipeline-overview/sync/{job_id}")
async def pipeline_overview_sync_job(
    job_id: str,
    user: UserInfo = Depends(require_authenticated_user),
):
    job = job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync job not found")
    return job
