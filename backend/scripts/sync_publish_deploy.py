#!/usr/bin/env python3
"""CLI: LSQ sync (via local API) → publish snapshots → git push.

Prefer the dashboard Sync button when LEADERSHIP_AUTO_DEPLOY_ON_SYNC=true —
sync then publish/push run automatically after LSQ completes.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

import os as _os

_os.chdir(str(BACKEND_ROOT))

from app.config import get_settings  # noqa: E402
from app.services.leadership_deploy_service import deploy_leadership_snapshots  # noqa: E402

DEFAULT_API_URL = "http://localhost:8000"
POLL_INTERVAL_SEC = 2.0
SYNC_TIMEOUT_SEC = 90 * 60


def _api_prefix(prefix: str) -> str:
    return prefix if prefix.startswith("/") else f"/{prefix}"


def _sync_headers(token: str) -> Dict[str, str]:
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if token.strip():
        headers["X-Sync-Token"] = token.strip()
    return headers


def run_sync_via_api(
    client: httpx.Client,
    api_prefix: str,
    token: str,
    mode: str,
) -> Dict[str, Any]:
    res = client.post(
        f"{api_prefix}/sync/leadsquared",
        json={"mode": mode},
        headers=_sync_headers(token),
        timeout=30.0,
    )
    if res.status_code >= 400:
        detail = res.text
        try:
            detail = res.json().get("detail", detail)
        except Exception:
            pass
        raise SystemExit(f"Failed to start sync ({res.status_code}): {detail}")

    job_id = res.json().get("job_id")
    if not job_id:
        raise SystemExit("Sync API did not return job_id")

    print(f"Sync started (mode={mode}, job_id={job_id})")
    deadline = time.monotonic() + SYNC_TIMEOUT_SEC
    last_phase = ""

    while time.monotonic() < deadline:
        status_res = client.get(f"{api_prefix}/sync/status/{job_id}", timeout=30.0)
        status_res.raise_for_status()
        job = status_res.json()
        status = job.get("status", "")
        phase = job.get("phase") or ""
        percent = job.get("percent")
        if phase != last_phase or percent is not None:
            pct = f" {round(float(percent))}%" if percent is not None else ""
            print(f"  {phase}{pct}")
            last_phase = phase

        if status == "completed":
            print(job.get("message") or "Sync completed")
            return job

        if status == "failed":
            err = job.get("error") or job.get("message") or "unknown error"
            raise SystemExit(f"Sync failed: {err}")

        time.sleep(POLL_INTERVAL_SEC)

    raise SystemExit(f"Sync timed out after {SYNC_TIMEOUT_SEC // 60} minutes")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync LSQ via API, then publish snapshots and push to main."
    )
    parser.add_argument("--full", action="store_true", help="Full LSQ backfill")
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--no-push", action="store_true", help="Publish only; skip git push")
    parser.add_argument("--message", default="", help="Custom git commit message")
    args = parser.parse_args()

    settings = get_settings()
    api_prefix = _api_prefix(settings.api_prefix)
    mode = "full" if args.full else "incremental"
    token = settings.sync_admin_token

    if settings.leadership_auto_deploy_on_sync:
        print(
            "LEADERSHIP_AUTO_DEPLOY_ON_SYNC is enabled — "
            "use the dashboard Sync button instead; deploy runs automatically."
        )

    with httpx.Client(base_url=args.api_url.rstrip("/"), timeout=30.0) as client:
        health = client.get("/health", timeout=10.0)
        health.raise_for_status()
        run_sync_via_api(client, api_prefix, token, mode)

    if settings.leadership_auto_deploy_on_sync:
        print("Leadership deploy ran automatically as part of sync.")
        return

    if args.no_push:
        from app.services.leadership_deploy_service import publish_snapshots

        publish_snapshots()
        print("Snapshots published (--no-push).")
        return

    ts = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")
    message = args.message or f"Refresh leadership snapshots (sync at {ts})."
    result = deploy_leadership_snapshots(commit_message=message)
    print(result.get("message") or "Done.")


if __name__ == "__main__":
    main()
