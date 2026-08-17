#!/usr/bin/env python3
"""Publish leadership analytics JSON snapshots for the static Vercel build.

Run from repo root or backend/:

  python backend/scripts/publish_snapshots.py

Writes to frontend/public/data/snapshots/ — commit or deploy those files
so Vercel serves charts without a hosted DB.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Allow `from app...` when invoked as a script
BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

# IMPORTANT: chdir to backend root so that relative paths in .env
# (e.g. DATA_DIR=./data, PARQUET_DIR=./data/parquet) resolve correctly,
# regardless of where this script is invoked from (repo root, frontend/, etc.).
import os as _os
_os.chdir(str(BACKEND_ROOT))

from app.domain.models import FilterParams  # noqa: E402
from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository  # noqa: E402
from app.services.analytics_service import AnalyticsEngine  # noqa: E402
from app.services.block_payment_service import BlockPaymentService  # noqa: E402
from app.services.persona_activity_service import PersonaActivityService  # noqa: E402
from app.services.refund_service import RefundService  # noqa: E402
from app.services.admissions_service import AdmissionsService  # noqa: E402
from app.services.admission_journey_service import AdmissionJourneyService  # noqa: E402
from app.services.pipeline_overview_service import PipelineOverviewService  # noqa: E402

OUT_DIR = REPO_ROOT / "frontend" / "public" / "data" / "snapshots"

PARTNER_STRIP_KEYS = ("block_amount_leads",)


def _to_ymd(d: date) -> str:
    return d.isoformat()


def _resolve_scopes(today: Optional[date] = None) -> Dict[str, Dict[str, Optional[str]]]:
    """Mirror frontend date-presets.ts (local calendar dates)."""
    today = today or date.today()
    date_to = _to_ymd(today)

    d7 = today - timedelta(days=6)
    d30 = today - timedelta(days=29)
    mtd_from = date(today.year, today.month, 1)
    month_end = date(today.year, today.month + 1, 1) - timedelta(days=1) if today.month < 12 else date(today.year, 12, 31)

    return {
        "all": {"date_from": None, "date_to": None, "label": "All time"},
        "7d": {"date_from": _to_ymd(d7), "date_to": date_to, "label": "Last 7d"},
        "mtd": {"date_from": _to_ymd(mtd_from), "date_to": date_to, "label": "MTD"},
        "30d": {"date_from": _to_ymd(d30), "date_to": date_to, "label": "Last 30d"},
        "month": {
            "date_from": _to_ymd(mtd_from),
            "date_to": _to_ymd(month_end),
            "label": "This month",
        },
    }


def _jsonable(obj: Any) -> Any:
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    if hasattr(obj, "model_dump"):
        return _jsonable(obj.model_dump(mode="json"))
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    return str(obj)


def _safe_partner_slug(name: str, used: Dict[str, str]) -> str:
    base = re.sub(r"[^\w\-]+", "_", name.strip(), flags=re.UNICODE).strip("_") or "partner"
    base = base[:120]
    slug = base
    n = 2
    while slug in used and used[slug] != name:
        slug = f"{base}_{n}"
        n += 1
    used[slug] = name
    return slug


def _filters_for_scope(scope: Dict[str, Optional[str]]) -> FilterParams:
    data: Dict[str, Any] = {}
    if scope.get("date_from"):
        data["date_from"] = scope["date_from"]
    if scope.get("date_to"):
        data["date_to"] = scope["date_to"]
    return FilterParams(**data)


def _strip_partner_detail(detail: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in detail.items() if k not in PARTNER_STRIP_KEYS}
    clashes = out.get("block_counsellor_clashes")
    if isinstance(clashes, dict):
        out["block_counsellor_clashes"] = {
            **clashes,
            "rows": [],
        }
    dp_refunds = out.get("block_dp_refunds")
    if isinstance(dp_refunds, dict):
        out["block_dp_refunds"] = {
            **dp_refunds,
            "rows": [],
        }
    return out


def _strip_clashes_list(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return payload
    return {
        **payload,
        "rows": [],
    }


def _payload_dict(payload: Any) -> Dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if hasattr(payload, "model_dump"):
        return payload.model_dump()
    return {}


def _strip_refund_cases(payload: Any) -> Dict[str, Any]:
    """Leadership snapshots: counts only — no student PII in public JSON."""
    data = _payload_dict(payload)
    if not data:
        return payload if isinstance(payload, dict) else {}
    return {
        "items": [],
        "total": int(data.get("total") or 0),
        "page": int(data.get("page") or 1),
        "page_size": int(data.get("page_size") or 500),
        "total_pages": int(data.get("total_pages") or 1),
    }


def _strip_block_payment_backtracking(payload: Any) -> Dict[str, Any]:
    """Leadership snapshots: aggregate reconciliation — no lead-level rows."""
    data = _payload_dict(payload)
    if not data:
        return payload if isinstance(payload, dict) else {}
    return {
        **data,
        "rows": [],
        "clash_rows": [],
    }


def _strip_admissions(payload: Any) -> Dict[str, Any]:
    """Leadership snapshots: KPIs/charts only — no student email/phone rows."""
    data = _payload_dict(payload)
    if not data:
        return payload if isinstance(payload, dict) else {}
    return {
        **data,
        "rows": [],
    }


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(_jsonable(data), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def _partner_names(engine: AnalyticsEngine, filters: FilterParams, comparison: Any) -> List[str]:
    names: List[str] = []
    seen: set[str] = set()

    cats = getattr(comparison, "categories", None)
    if cats is None and isinstance(comparison, dict):
        cats = comparison.get("categories") or []
    for p in cats or []:
        s = str(p).strip()
        if s and s not in seen:
            seen.add(s)
            names.append(s)

    opts = engine.get_filter_options()
    for p in opts.get("partners") or []:
        s = str(p).strip()
        if s and s not in seen:
            seen.add(s)
            names.append(s)

    return names


def _publish_admission_journey(duck: DuckDBRepository, out_dir: Path) -> None:
    """Write Admission Journey + pipeline overview snapshots (same UI as local)."""
    journey_svc = AdmissionJourneyService(duck_repo=duck)
    pipeline_svc = PipelineOverviewService(duck_repo=duck)

    status = journey_svc.get_status()
    _write_json(out_dir / "admission_journey_status.json", status)

    students = journey_svc.list_students(page=1, page_size=50000)
    items = students.get("items") or []
    _write_json(out_dir / "admission_journey_students.json", items)

    details: Dict[str, Any] = {}
    for row in items:
        jid = str(row.get("journey_id") or "").strip()
        if not jid:
            continue
        detail = journey_svc.get_student(jid)
        if detail:
            details[jid] = detail
    _write_json(out_dir / "admission_journey_details.json", details)

    overview = pipeline_svc.get_overview()
    if isinstance(overview, dict):
        overview.pop("note", None)
    _write_json(out_dir / "pipeline_overview.json", overview)
    print(
        f"  admission journey: {len(items)} students, "
        f"{len(details)} details, pipeline has_data={overview.get('has_data')}"
    )


def publish() -> Path:
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # read_only so publish works while local uvicorn holds the DB file
    duck = DuckDBRepository(read_only=True)
    cache = AnalyticsCache(ttl_seconds=0)
    engine = AnalyticsEngine(duck_repo=duck, cache=cache)
    block_svc = BlockPaymentService(duck_repo=duck)
    persona_svc = PersonaActivityService(duck_repo=duck)
    refund_svc = RefundService(duck_repo=duck)
    admissions_svc = AdmissionsService(duck_repo=duck)

    scopes = _resolve_scopes()
    published_at = datetime.now().astimezone().isoformat(timespec="seconds")
    partner_slugs_global: Dict[str, str] = {}  # name -> slug (stable across scopes)
    slug_used: Dict[str, str] = {}
    scope_meta: Dict[str, Any] = {}

    # Shared status (not filter-scoped)
    _write_json(OUT_DIR / "stats.json", engine.get_dataset_stats())
    _write_json(OUT_DIR / "filters.json", engine.get_filter_options())
    _write_json(OUT_DIR / "block_payment_status.json", block_svc.get_status())
    _write_json(OUT_DIR / "refund_status.json", refund_svc.get_status())
    _write_json(OUT_DIR / "admissions_status.json", admissions_svc.get_status())
    _write_json(OUT_DIR / "persona_activity_status.json", persona_svc.get_status())
    _publish_admission_journey(duck, OUT_DIR)

    for scope_id, scope in scopes.items():
        print(f"Publishing scope={scope_id} …")
        filters = _filters_for_scope(scope)
        scope_dir = OUT_DIR / scope_id
        scope_dir.mkdir(parents=True, exist_ok=True)

        comparison = engine.get_partner_comparison(filters)
        partners = _partner_names(engine, filters, comparison)
        partner_files: Dict[str, str] = {}

        payloads: List[Tuple[str, Any]] = [
            ("executive_kpis", engine.get_executive_kpis(filters)),
            ("executive_charts", engine.get_executive_charts(filters)),
            ("funnel", engine.get_funnel_data(filters)),
            ("funnel_trends", engine.get_funnel_trends(filters)),
            ("partner", comparison),
            ("conversion_rates", engine.get_conversion_rates(filters)),
            ("contactability", engine.get_contactability_dashboard(filters)),
            ("ai_calling", engine.get_ai_calling_stats(filters)),
            ("persona", engine.get_persona_analytics(filters)),
            ("campaign", engine.get_campaign_analytics(filters)),
            ("geographic", engine.get_geographic_data(filters)),
            ("geographic_states", engine.get_geographic_state_summary(filters)),
            ("revenue", engine.get_revenue_dashboard(filters)),
            ("predictive", engine.get_predictive_analytics(filters)),
            ("campus_bifurcation", engine.get_campus_bifurcation(filters)),
            ("admissions_dp", _strip_admissions(engine.get_dp_admissions(filters))),
            ("admissions_campus", _strip_admissions(engine.get_campus_admissions(filters))),
            (
                "refund_cases",
                _strip_refund_cases(
                    engine.get_refund_cases(filters, page=1, page_size=500)
                ),
            ),
            (
                "block_payment_backtracking",
                _strip_block_payment_backtracking(
                    engine.get_block_payment_backtracking(filters)
                ),
            ),
            ("block_payment_attribution", engine.get_block_payment_attribution(filters)),
            ("alerts", engine.get_alerts(filters)),
            ("anomalies", engine.get_anomalies(filters)),
            ("goals", engine.get_goals(filters)),
            ("compare_week", engine.get_period_compare(filters, grain="week")),
            ("compare_month", engine.get_period_compare(filters, grain="month")),
            ("cohorts_week", engine.get_cohorts(filters, by="week")),
            ("cohorts_month", engine.get_cohorts(filters, by="month")),
            (
                "partner_counsellor_clashes",
                _strip_clashes_list(engine.get_partner_counsellor_clashes(filters)),
            ),
            (
                "partner_dp_refunds",
                _strip_clashes_list(engine.get_partner_dp_refunds(filters)),
            ),
            (
                "partner_trends_daily",
                engine.get_partner_metric_trends(filters, grain="daily"),
            ),
            (
                "partner_trends_weekly",
                engine.get_partner_metric_trends(filters, grain="weekly"),
            ),
            (
                "partner_trends_monthly",
                engine.get_partner_metric_trends(filters, grain="monthly"),
            ),
        ]

        for filename, data in payloads:
            _write_json(scope_dir / f"{filename}.json", data)

        for partner in partners:
            if partner not in partner_slugs_global:
                partner_slugs_global[partner] = _safe_partner_slug(partner, slug_used)
            slug = partner_slugs_global[partner]
            partner_files[partner] = f"partner__{slug}.json"
            detail = engine.get_partner_detail(filters, partner)
            _write_json(scope_dir / f"partner__{slug}.json", _strip_partner_detail(detail))

        scope_meta[scope_id] = {
            **scope,
            "partner_count": len(partners),
            "partners": partner_files,
        }
        print(f"  wrote {len(payloads)} endpoints + {len(partners)} partner details")

    manifest = {
        "published_at": published_at,
        "version": 1,
        "scopes": scope_meta,
        "partner_slugs": partner_slugs_global,
        "shared": [
            "stats.json",
            "filters.json",
            "block_payment_status.json",
            "refund_status.json",
            "admissions_status.json",
            "persona_activity_status.json",
            "admission_journey_status.json",
            "admission_journey_students.json",
            "admission_journey_details.json",
            "pipeline_overview.json",
        ],
    }
    _write_json(OUT_DIR / "manifest.json", manifest)
    (OUT_DIR / "README.md").write_text(
        "# Leadership snapshots\n\n"
        "Generated by `python backend/scripts/publish_snapshots.py` "
        "(or `npm run publish:snapshots`).\n\n"
        "These JSON files power the Vercel leadership build "
        "(`NEXT_PUBLIC_DATA_MODE=static`).\n"
        "Aggregated charts/KPIs only — not raw lead rows.\n",
        encoding="utf-8",
    )
    print(f"Done -> {OUT_DIR}")
    print(f"Published at {published_at}")
    return OUT_DIR


if __name__ == "__main__":
    try:
        publish()
    except Exception as exc:
        print(f"publish_snapshots failed: {exc}", file=sys.stderr)
        raise
