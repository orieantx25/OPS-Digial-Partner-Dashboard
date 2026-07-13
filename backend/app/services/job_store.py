"""In-memory job registry tracking asynchronous upload progress.

Single-process (uvicorn) friendly. If the app is ever scaled to multiple
workers, replace this with a shared store (Redis / DB).
"""

import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Optional


@dataclass
class UploadJob:
    job_id: str
    status: str = "queued"  # queued | processing | completed | failed
    phase: str = "Queued"
    percent: float = 0.0
    rows_total: int = 0
    rows_processed: int = 0
    message: str = ""
    report: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


class JobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, UploadJob] = {}
        self._lock = threading.Lock()

    def create(self, job_id: str) -> None:
        with self._lock:
            self._jobs[job_id] = UploadJob(job_id=job_id)
            self._prune_locked()

    def update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            for key, value in fields.items():
                setattr(job, key, value)
            job.updated_at = time.time()

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            job = self._jobs.get(job_id)
            return asdict(job) if job else None

    def _prune_locked(self, max_age_seconds: int = 3600, max_jobs: int = 200) -> None:
        """Drop old finished jobs to keep the registry small."""
        now = time.time()
        stale = [
            jid
            for jid, j in self._jobs.items()
            if j.status in ("completed", "failed") and now - j.updated_at > max_age_seconds
        ]
        for jid in stale:
            self._jobs.pop(jid, None)
        if len(self._jobs) > max_jobs:
            oldest = sorted(self._jobs.values(), key=lambda j: j.updated_at)[
                : len(self._jobs) - max_jobs
            ]
            for j in oldest:
                self._jobs.pop(j.job_id, None)


job_store = JobStore()
