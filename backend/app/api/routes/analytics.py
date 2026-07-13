"""Analytics API routes."""

import csv
import io
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api.dependencies import get_analytics_engine, parse_filters
from app.domain.models import FilterParams
from app.services.analytics_service import AnalyticsEngine

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/stats")
async def dataset_stats(engine: AnalyticsEngine = Depends(get_analytics_engine)):
    return engine.get_dataset_stats()


@router.get("/filters")
async def filter_options(engine: AnalyticsEngine = Depends(get_analytics_engine)):
    return engine.get_filter_options()


@router.get("/executive/kpis")
async def executive_kpis(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_executive_kpis(filters)


@router.get("/executive/charts")
async def executive_charts(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_executive_charts(filters)


@router.get("/funnel")
async def funnel(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_funnel_data(filters)


@router.get("/partner")
async def partner_analytics(
    filters: FilterParams = Depends(parse_filters),
    partner: Optional[str] = Query(None),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    if partner:
        return engine.get_partner_detail(filters, partner)
    return engine.get_partner_comparison(filters)


@router.get("/partner/counsellor-clashes")
async def partner_counsellor_clashes(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_partner_counsellor_clashes(filters)


@router.get("/contactability")
async def contactability(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_contactability_dashboard(filters)


@router.get("/ai-calling")
async def ai_calling(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_ai_calling_stats(filters)


@router.get("/persona")
async def persona(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_persona_analytics(filters)


@router.get("/campaign")
async def campaign(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_campaign_analytics(filters)


@router.get("/geographic")
async def geographic(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_geographic_data(filters)


@router.get("/geographic/states")
async def geographic_states(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_geographic_state_summary(filters)


@router.get("/revenue")
async def revenue(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_revenue_dashboard(filters)


@router.get("/predictive")
async def predictive(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_predictive_analytics(filters)


@router.get("/block-payment/backtracking")
async def block_payment_backtracking(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_block_payment_backtracking(filters)


@router.get("/alerts")
async def alerts(
    filters: FilterParams = Depends(parse_filters),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.get_alerts(filters)


@router.get("/search")
async def search(
    filters: FilterParams = Depends(parse_filters),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    return engine.search_leads(filters, page=page, page_size=page_size)


@router.get("/export")
async def export_data(
    filters: FilterParams = Depends(parse_filters),
    format: str = Query("csv", regex="^(csv|json)$"),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
):
    data = engine.export_data(filters)
    if format == "json":
        return data

    if not data:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["no_data"])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=export.csv"},
        )

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=data[0].keys())
    writer.writeheader()
    writer.writerows(data)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=export.csv"},
    )
