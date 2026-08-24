"""Publish leadership JSON snapshots and push to GitHub for Vercel redeploy."""

from __future__ import annotations

import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from app.logging_config import get_logger

logger = get_logger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent
SNAPSHOTS_REL = "frontend/public/data/snapshots"

# Prevent dashboard Sync from hanging forever on publish/git.
PUBLISH_TIMEOUT_SEC = 600
GIT_TIMEOUT_SEC = 120

ProgressCb = Optional[Callable[[float, str], None]]


def _emit(cb: ProgressCb, percent: float, phase: str) -> None:
    if cb:
        try:
            cb(percent, phase)
        except Exception:
            pass


def _run(
    cmd: List[str], *, timeout: int, check: bool = True
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        check=check,
        timeout=timeout,
        capture_output=True,
        text=True,
    )


def publish_snapshots() -> None:
    script = BACKEND_ROOT / "scripts" / "publish_snapshots.py"
    logger.info("leadership_publish_start")
    try:
        _run([sys.executable, str(script)], timeout=PUBLISH_TIMEOUT_SEC, check=True)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"Publishing snapshots timed out after {PUBLISH_TIMEOUT_SEC}s"
        ) from exc
    logger.info("leadership_publish_done")


def git_commit_and_push(message: str) -> Dict[str, Any]:
    snapshots_path = REPO_ROOT / SNAPSHOTS_REL
    if not snapshots_path.is_dir():
        raise RuntimeError(f"Snapshot directory missing: {snapshots_path}")

    try:
        _run(["git", "add", SNAPSHOTS_REL.replace("\\", "/")], timeout=GIT_TIMEOUT_SEC)
        diff = _run(
            ["git", "diff", "--cached", "--quiet"], timeout=GIT_TIMEOUT_SEC, check=False
        )
        if diff.returncode == 0:
            return {
                "pushed": False,
                "message": "Snapshots unchanged — no git commit needed",
            }

        _run(["git", "commit", "-m", message], timeout=GIT_TIMEOUT_SEC)
        _run(["git", "push", "origin", "main"], timeout=GIT_TIMEOUT_SEC)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Git deploy timed out after {GIT_TIMEOUT_SEC}s") from exc

    logger.info("leadership_git_push_done", message=message)
    return {
        "pushed": True,
        "message": "Pushed to main — Vercel will redeploy the leadership dashboard",
    }


def deploy_leadership_snapshots(
    commit_message: Optional[str] = None,
    progress_cb: ProgressCb = None,
) -> Dict[str, Any]:
    """
    Publish snapshots from current local data (including existing block sheet if
    no new Metabase CSV was uploaded) and push to origin/main.
    """
    _emit(progress_cb, 96.0, "Publishing leadership snapshots")
    publish_snapshots()

    ts = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")
    message = commit_message or f"Refresh leadership snapshots (sync at {ts})."

    _emit(progress_cb, 98.0, "Pushing to GitHub")
    git_result = git_commit_and_push(message)

    return {
        "status": "completed",
        "commit_message": message,
        **git_result,
    }
