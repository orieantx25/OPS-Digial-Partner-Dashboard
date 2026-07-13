"""Default empty responses when MASTER_DATASET has no rows."""

from typing import Any, Dict, List

from app.domain.models import AlertItem, ChartData, ChartSeries, KpiMetric, PaginatedResponse
from app.domain.schema import FUNNEL_STAGES

KPI_DEFINITIONS = [
    ("total_leads", "Total Leads"),
    ("connected", "Connected"),
    ("ai_connected", "AI Connected"),
    ("ac_connected", "AC Connected"),
    ("contactability", "Contactability"),
    ("never_dialed", "Leads not Touched"),
    ("mql", "MQL"),
    ("sql", "SQL"),
    ("applications", "Applications"),
    ("test_registrations", "Registrations"),
    ("offer_letters", "Offer Letters"),
    ("block_amount_paid", "Block Amount Paid"),
    ("admissions", "Admissions"),
    ("revenue", "Revenue"),
    ("roi", "ROI %"),
    ("ai_calls", "AI Calls"),
    ("avg_dial_count", "Avg Dial Count"),
    ("dnp_pct", "DNP %"),
]


def empty_kpis() -> List[KpiMetric]:
    return [
        KpiMetric(key=key, label=label, current=0, previous=0, change_pct=0, trend=[])
        for key, label in KPI_DEFINITIONS
    ]


def empty_chart(chart_id: str, chart_type: str, title: str) -> ChartData:
    return ChartData(chart_id=chart_id, chart_type=chart_type, title=title)


def empty_funnel() -> ChartData:
    return ChartData(
        chart_id="funnel",
        chart_type="funnel",
        title="Lead Funnel",
        categories=FUNNEL_STAGES,
        series=[ChartSeries(name="Count", data=[0] * len(FUNNEL_STAGES))],
        extra={
            "conversions": [100.0] + [0.0] * (len(FUNNEL_STAGES) - 1),
            "drops": [0.0] * len(FUNNEL_STAGES),
            "connected_split": {"ai_connected": 0, "ac_connected": 0},
        },
    )


def empty_executive_charts() -> Dict[str, ChartData]:
    return {
        "daily_leads": empty_chart("leads_daily", "line", "Daily Leads"),
        "weekly_leads": empty_chart("leads_weekly", "line", "Weekly Leads"),
        "monthly_leads": empty_chart("leads_monthly", "line", "Monthly Leads"),
        "partner_comparison": empty_chart("partner_comparison", "bar", "Partner Comparison"),
        "lead_sources": empty_chart("lead_sources", "donut", "Leads by Partner"),
        "state_distribution": empty_chart("state_distribution", "bar", "State Distribution"),
        "call_distribution": empty_chart("call_distribution", "bar", "Call Distribution"),
        "funnel": empty_funnel(),
        "heatmap": ChartData(chart_id="heatmap", chart_type="heatmap", title="Lead Activity Heatmap", extra={"data": []}),
        "contactability_trend": empty_chart("contactability_trend", "line", "Contactability Trend"),
    }


def empty_ai_calling() -> Dict[str, int]:
    return {
        "calls": 0, "qualified": 0, "warm": 0, "high_intent": 0,
        "payment_link": 0, "brochure": 0, "dnp": 0, "interested": 0, "callback": 0,
    }


def empty_revenue() -> Dict[str, Any]:
    return {
        "partners": [],
        "totals": {
            "admissions": 0,
            "block_amount_paid": 0,
            "counsellor_clashes": 0,
            "block_amount_roi": 0,
            "advance_total": 0,
            "incentive_total": 0,
            "cost_total": 0,
            "revenue_total": 0,
            "profit_total": 0,
            "revenue_per_admission": 550_000,
            "breakeven_partners": 0,
            "partners_below_breakeven": 0,
            "has_clash_sheet": False,
        },
    }


def empty_predictive() -> Dict[str, Any]:
    return {
        "lead_forecast": [],
        "block_amount_forecast": [],
        "monthly_history": [],
        "partner_growth": [],
        "lead_chart": {
            "chart_id": "lead_forecast",
            "chart_type": "line",
            "title": "Lead Forecast",
            "categories": [],
            "series": [],
        },
        "block_amount_chart": {
            "chart_id": "block_amount_forecast",
            "chart_type": "line",
            "title": "Block Amount Forecast",
            "categories": [],
            "series": [],
        },
        "forecast_horizon": {"from": None, "to": None},
        "avg_lead_jump_pct": 0,
        "avg_block_jump_pct": 0,
    }


def empty_search() -> PaginatedResponse:
    return PaginatedResponse(items=[], total=0, page=1, page_size=50, total_pages=1)


def empty_alerts() -> List[AlertItem]:
    return []
