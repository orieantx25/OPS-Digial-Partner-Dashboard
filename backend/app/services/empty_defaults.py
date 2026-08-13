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
        "leads_trend": empty_chart("leads_trend", "line", "Leads Trend"),
        "test_taker_trend": empty_chart("test_taker_trend", "line", "Test Taker Trend"),
        "persona_know_more_trend": empty_chart(
            "persona_know_more_trend", "line", "Know More about B.Tech Trend"
        ),
        "block_amount_trend": empty_chart("block_amount_trend", "line", "Block Amount Trend"),
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
            "dp_refunds": 0,
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
            "has_refund_sheet": False,
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
        "lead_months_used": 0,
        "block_months_used": 0,
        "mtd_run_rate": None,
        "daily_history": [],
        "daily_lead_chart": {
            "chart_id": "daily_leads_mtd",
            "chart_type": "line",
            "title": "Daily Leads",
            "categories": [],
            "series": [],
        },
    }


def empty_campus_bifurcation() -> Dict[str, Any]:
    return {
        "has_sheet": False,
        "total_block_paid": 0,
        "matched_count": 0,
        "sheet_total": 0,
        "digital_partner_count": 0,
        "digital_partner_share_pct": 0,
        "sheet_by_campus": [],
        "sheet_by_gender": [],
        "sheet_campus_gender_charts": [],
        "sheet_campus_chart": {
            "chart_id": "sheet_campus_block_paid",
            "chart_type": "bar",
            "title": "All block received by campus",
            "categories": [],
            "series": [],
        },
        "sheet_gender_chart": {
            "chart_id": "sheet_gender_block_paid",
            "chart_type": "donut",
            "title": "All block received by gender",
            "categories": [],
            "series": [],
            "extra": {
                "center_total": 0,
                "center_label": "All received",
                "compact_donut": True,
                "show_slice_labels": True,
            },
        },
        "by_campus": [],
        "by_gender": [],
        "campus_gender_charts": [],
        "digital_partner_share_chart": {
            "chart_id": "digital_partner_block_share",
            "chart_type": "donut",
            "title": "Block amount received — digital partner share",
            "categories": [],
            "series": [],
            "extra": {
                "center_total": 0,
                "center_label": "All received",
                "compact_donut": True,
                "show_slice_labels": True,
            },
        },
        "campus_chart": {
            "chart_id": "campus_block_paid",
            "chart_type": "bar",
            "title": "Block Amount Paid by Campus",
            "categories": [],
            "series": [],
        },
        "gender_chart": {
            "chart_id": "gender_block_paid",
            "chart_type": "donut",
            "title": "Block Amount Paid by Gender",
            "categories": [],
            "series": [],
            "extra": {
                "center_total": 0,
                "center_label": "Total",
                "compact_donut": True,
                "show_slice_labels": True,
            },
        },
        "matched_summary": {
            "total": 0,
            "by_gender": [],
            "by_campus": [],
        },
        "partner_share": [],
        "partner_share_by_gender": [],
        "partner_share_by_campus": [],
        "partner_gender_chart": {
            "chart_id": "partner_share_gender",
            "chart_type": "bar",
            "title": "Partner share by gender",
            "categories": [],
            "series": [],
        },
        "partner_campus_chart": {
            "chart_id": "partner_share_campus",
            "chart_type": "bar",
            "title": "Partner share by campus",
            "categories": [],
            "series": [],
        },
        "refund_summary": {
            "total_cases": 0,
            "retained_cases": 0,
            "refunded_cases": 0,
            "refund_cases": 0,
            "refund_processed": 0,
            "digital_partner_refund_cases": 0,
            "by_campus": {"SSAHE": 0, "ADYPU": 0},
            "refunds_applied_by_campus": {"SSAHE": 0, "ADYPU": 0},
            "retained_by_campus": {"SSAHE": 0, "ADYPU": 0},
            "refunded_by_campus": {"SSAHE": 0, "ADYPU": 0},
            "dp_refund_requests": {
                "total": 0,
                "by_campus": {"SSAHE": 0, "ADYPU": 0},
                "refunded_by_campus": {"SSAHE": 0, "ADYPU": 0},
            },
        },
        "sheet_unassigned_count": 0,
        "adjusted_sheet_total": 0,
        "active_block_excluded_count": 0,
        "adjusted_sheet_by_campus": [],
        "adjusted_sheet_by_gender": [],
        "adjusted_sheet_campus_chart": {
            "chart_id": "adjusted_sheet_campus_block_paid",
            "chart_type": "bar",
            "title": "Active block received by campus",
            "categories": [],
            "series": [],
        },
        "adjusted_sheet_gender_chart": {
            "chart_id": "adjusted_sheet_gender_block_paid",
            "chart_type": "donut",
            "title": "Active block received by gender",
            "categories": [],
            "series": [],
            "extra": {
                "center_total": 0,
                "center_label": "Active total",
                "compact_donut": True,
                "show_slice_labels": True,
            },
        },
        "adjusted_sheet_campus_gender_charts": [],
        "sheet_state_summary": [],
        "adjusted_sheet_state_summary": [],
        "dp_refund_by_campus_chart": {
            "chart_id": "dp_refund_by_campus",
            "chart_type": "bar",
            "title": "Digital partner refunds by campus",
            "categories": [],
            "series": [],
        },
        "overall_refund_by_campus_chart": {
            "chart_id": "overall_refund_by_campus",
            "chart_type": "bar",
            "title": "Refund cases by campus",
            "categories": [],
            "series": [],
        },
    }


def empty_refund_cases() -> PaginatedResponse:
    return PaginatedResponse(items=[], total=0, page=1, page_size=50, total_pages=1)


def empty_dp_admissions() -> Dict[str, Any]:
    return {
        "has_sheet": False,
        "total_paid": 0,
        "verified_sem1": 0,
        "dp_matched": 0,
        "by_partner": [],
        "partner_chart": {
            "chart_id": "dp_admissions_by_partner",
            "chart_type": "bar",
            "title": "DP admissions by partner",
            "categories": [],
            "series": [],
        },
        "fee_status": {
            "has_lms": False,
            "verified": 0,
            "partly_paid": 0,
            "under_review": 0,
            "rejected": 0,
            "total_rows": 0,
            "sem1_rows": 0,
            "by_status": [],
            "status_chart": None,
            "by_campus_verified": [],
        },
        "rows": [],
    }


def empty_campus_admissions() -> Dict[str, Any]:
    return {
        "has_sheet": False,
        "total_paid": 0,
        "verified_sem1": 0,
        "matched_to_block": 0,
        "unmatched_to_block": 0,
        "by_campus": [],
        "by_gender": [],
        "campus_chart": {
            "chart_id": "campus_admissions_by_campus",
            "chart_type": "bar",
            "title": "Admissions by campus",
            "categories": [],
            "series": [],
        },
        "gender_chart": {
            "chart_id": "campus_admissions_by_gender",
            "chart_type": "donut",
            "title": "Admissions by gender",
            "categories": [],
            "series": [],
            "extra": {
                "center_total": 0,
                "center_label": "Paid",
                "compact_donut": True,
                "show_slice_labels": True,
            },
        },
        "campus_gender_charts": [],
        "admission_state_summary": [],
        "fee_status": {
            "has_lms": False,
            "verified": 0,
            "partly_paid": 0,
            "under_review": 0,
            "rejected": 0,
            "total_rows": 0,
            "sem1_rows": 0,
            "by_status": [],
            "status_chart": None,
            "by_campus_verified": [],
        },
        "rows": [],
    }


def empty_search() -> PaginatedResponse:
    return PaginatedResponse(items=[], total=0, page=1, page_size=50, total_pages=1)


def empty_alerts() -> List[AlertItem]:
    return []
