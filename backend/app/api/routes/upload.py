"""Upload and ingestion API routes."""

import threading
import uuid
from typing import List, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.dependencies import require_write_access
from app.domain.models import UploadReport, UserInfo
from app.infrastructure.database import UploadBatchRecord, get_session_factory
from app.logging_config import get_logger
from app.services.ingestion_service import IngestionEngine
from app.services.job_store import job_store

router = APIRouter(prefix="/upload", tags=["upload"])
logger = get_logger(__name__)


def _persist_report(report: UploadReport) -> None:
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        record = UploadBatchRecord(
            id=report.batch_id,
            status=report.status.value,
            started_at=report.started_at,
            completed_at=report.completed_at,
            total_files=report.total_files,
            total_rows_read=report.total_rows_read,
            total_rows_accepted=report.total_rows_accepted,
            total_rows_rejected=report.total_rows_rejected,
            duplicate_count=report.duplicate_count,
            master_dataset_total_rows=report.master_dataset_total_rows,
            report_json=report.model_dump_json(),
            message=report.message,
        )
        db.add(record)
        db.commit()
    except Exception as exc:  # pragma: no cover - persistence is best-effort
        logger.error("upload_report_persist_failed", batch_id=report.batch_id, error=str(exc))
        db.rollback()
    finally:
        db.close()


def _run_upload_job(
    job_id: str,
    file_tuples: List[Tuple[str, bytes]],
    replace: bool,
    username: str,
) -> None:
    """Runs in a background thread; streams progress into the job store."""
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
        engine = IngestionEngine()
        report = engine.process_upload_batch(
            file_tuples, batch_id=job_id, replace=replace, progress_cb=cb
        )
        _persist_report(report)
        job_store.update(
            job_id,
            status="completed",
            percent=100.0,
            phase="Completed",
            rows_processed=report.total_rows_accepted,
            message=report.message,
            report=report.model_dump(mode="json"),
        )
        logger.info(
            "upload_job_done", job_id=job_id, user=username,
            status=report.status.value, rows_accepted=report.total_rows_accepted,
        )
    except Exception as exc:
        logger.error("upload_job_failed", job_id=job_id, error=str(exc))
        job_store.update(
            job_id,
            status="failed",
            phase="Failed",
            error=str(exc),
            message=f"Upload failed: {exc}",
        )


@router.post("")
async def upload_files(
    files: List[UploadFile] = File(...),
    replace: bool = Form(True),
    user: UserInfo = Depends(require_write_access),
):
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files provided")

    file_tuples: List[Tuple[str, bytes]] = []
    for f in files:
        content = await f.read()
        if not content:
            continue
        file_tuples.append((f.filename or "unknown", content))

    if not file_tuples:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="All files were empty")

    job_id = str(uuid.uuid4())
    job_store.create(job_id)
    logger.info(
        "upload_started", job_id=job_id, user=user.username,
        file_count=len(file_tuples), replace=replace,
    )

    thread = threading.Thread(
        target=_run_upload_job,
        args=(job_id, file_tuples, replace, user.username),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "processing"}


@router.get("/status/{job_id}")
async def upload_status(job_id: str):
    job = job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload job not found")
    return job


@router.get("/history")
async def upload_history(limit: int = 20):
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        records = (
            db.query(UploadBatchRecord)
            .order_by(UploadBatchRecord.started_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "batch_id": r.id,
                "status": r.status,
                "started_at": r.started_at.isoformat(),
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "total_files": r.total_files,
                "total_rows_accepted": r.total_rows_accepted,
                "duplicate_count": r.duplicate_count,
                "master_dataset_total_rows": r.master_dataset_total_rows,
                "message": r.message,
            }
            for r in records
        ]
    finally:
        db.close()


@router.get("/report/{batch_id}", response_model=UploadReport)
async def get_upload_report(batch_id: str):
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        record = db.query(UploadBatchRecord).filter(UploadBatchRecord.id == batch_id).first()
        if not record or not record.report_json:
            raise HTTPException(status_code=404, detail="Upload report not found")
        return UploadReport.model_validate_json(record.report_json)
    finally:
        db.close()
