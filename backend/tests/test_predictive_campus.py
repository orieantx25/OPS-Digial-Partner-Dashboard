"""Tests for predictive analytics and campus bifurcation."""

import io
from datetime import date

import polars as pl

from app.domain.models import FilterParams
from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
from app.services.analytics_service import AnalyticsEngine
from app.services.block_payment_service import BlockPaymentService
from app.services.ingestion_service import IngestionEngine


def test_predictive_mtd_run_rate_nonzero(temp_settings):
    """Single-month MTD filter should produce non-zero run-rate projection."""
    master = pl.DataFrame({
        "Prospect ID": [f"p{i}" for i in range(10)],
        "Main Lead Stages": ["Sign Up"] * 10,
        "Contact Source": ["Careers360"] * 10,
        "Date": [
            "2026-08-01",
            "2026-08-02",
            "2026-08-03",
            "2026-08-03",
            "2026-08-03",
            "2026-08-01",
            "2026-08-02",
            "2026-08-01",
            "2026-08-02",
            "2026-08-03",
        ],
    })
    buf = io.BytesIO()
    master.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    engine.process_upload_batch([("master.csv", buf.getvalue())])

    analytics = AnalyticsEngine(
        duck_repo=DuckDBRepository(temp_settings), cache=AnalyticsCache(ttl_seconds=0)
    )
    result = analytics.get_predictive_analytics(
        FilterParams(date_from="2026-08-01", date_to="2026-08-03")
    )

    assert result["forecast_horizon"]["from"] == "2026-08"
    assert result["forecast_horizon"]["to"] == "2026-09"
    mtd = result["mtd_run_rate"]
    assert mtd["lead_mtd"] == 10
    assert mtd["lead_projected"] is not None
    assert mtd["lead_projected"] > 10
    assert result["lead_forecast"][0]["value"] > 0


def test_predictive_horizon_not_hardcoded_july_august(temp_settings):
    master = pl.DataFrame({
        "Prospect ID": ["a", "b"],
        "Main Lead Stages": ["Sign Up", "Sign Up"],
        "Contact Source": ["Careers360", "Careers360"],
        "Date": ["2026-05-15", "2026-06-20"],
    })
    buf = io.BytesIO()
    master.write_csv(buf)
    ingest = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    ingest.process_upload_batch([("master.csv", buf.getvalue())])

    analytics = AnalyticsEngine(
        duck_repo=DuckDBRepository(temp_settings), cache=AnalyticsCache(ttl_seconds=0)
    )
    result = analytics.get_predictive_analytics(
        FilterParams(date_to="2026-06-20")
    )
    horizon = result["forecast_horizon"]
    assert horizon["from"] == "2026-06"
    assert horizon["to"] == "2026-07"
    assert horizon["from"] != "2026-07"
    assert horizon["to"] != "2026-08"


def test_predictive_monthly_history_from_date_column(temp_settings):
    master = pl.DataFrame({
        "Prospect ID": ["a", "b", "c"],
        "Main Lead Stages": ["Sign Up"] * 3,
        "Contact Source": ["Careers360"] * 3,
        "Date": ["2026-07-10", "2026-08-05", "2026-08-12"],
    })
    buf = io.BytesIO()
    master.write_csv(buf)
    ingest = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    ingest.process_upload_batch([("master.csv", buf.getvalue())])

    analytics = AnalyticsEngine(
        duck_repo=DuckDBRepository(temp_settings), cache=AnalyticsCache(ttl_seconds=0)
    )
    history = analytics.get_predictive_analytics(FilterParams())["monthly_history"]
    months = {r["month"] for r in history}
    assert "2026-07" in months
    assert "2026-08" in months


def test_campus_display_label():
    assert AnalyticsEngine._campus_display_label(
        "ADYPU", "Ajeenkya DY Patil University, Pune"
    ) == "ADYPU, Pune"
    assert AnalyticsEngine._campus_display_label(
        "SSAHE", "Sri Siddhartha Academy of Higher Education, Tumkur"
    ) == "SSAHE, Tumkur"


def test_campus_bifurcation_matched_only(temp_settings):
    master = pl.DataFrame({
        "Prospect ID": ["bp1", "bp2", "bp3"],
        "Email": ["a@test.com", "b@test.com", "c@test.com"],
        "Phone": ["9999999991", "9999999992", "9999999993"],
        "Contact Stage": ["Block Amount Paid"] * 3,
        "Main Lead Stages": ["Sign Up"] * 3,
        "Contact Source": ["Careers360"] * 3,
        "Date": ["2026-08-01", "2026-08-02", "2026-08-03"],
    })
    buf = io.BytesIO()
    master.write_csv(buf)
    ingest = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    ingest.process_upload_batch([("master.csv", buf.getvalue())])

    sheet = pl.DataFrame({
        "Email": ["a@test.com", "b@test.com"],
        "Phone": ["9999999991", "9999999992"],
        "Gender": ["Male", "Female"],
        "State": ["Karnataka", "Maharashtra"],
        "SeatBlocking: CollegeCode": ["CAMP01", "CAMP02"],
        "SeatBlocking: CollegeName": ["Campus One", "Campus Two"],
        "Source at Payment": ["Partner", "Partner"],
    })
    sheet_buf = io.BytesIO()
    sheet.write_csv(sheet_buf)

    block_svc = BlockPaymentService(
        duck_repo=DuckDBRepository(temp_settings), settings=temp_settings
    )
    block_svc.upload_sheet("sheet.csv", sheet_buf.getvalue())

    analytics = AnalyticsEngine(
        duck_repo=DuckDBRepository(temp_settings), cache=AnalyticsCache(ttl_seconds=0)
    )
    result = analytics.get_campus_bifurcation(FilterParams())

    assert result["has_sheet"] is True
    assert result["total_block_paid"] == 3
    assert result["matched_count"] == 2
    assert len(result["by_campus"]) == 2
    codes = {c["campus_code"] for c in result["by_campus"]}
    assert "CAMP01" in codes
    assert "CAMP02" in codes
    genders = {g["gender"] for g in result["by_gender"]}
    assert "Male" in genders
    assert "Female" in genders

    summary = result["matched_summary"]
    assert summary["total"] == 2
    assert len(summary["by_gender"]) == 2
    assert len(summary["by_campus"]) == 2
    assert summary["by_gender"][0]["share_pct"] > 0

    assert len(result["partner_share"]) >= 1
    assert result["partner_share"][0]["partner"] == "Careers360"
    assert result["partner_share"][0]["count"] == 2
    assert len(result["partner_share_by_gender"]) == 2
    assert len(result["partner_share_by_campus"]) == 2
    assert result["partner_gender_chart"].series
    assert result["partner_campus_chart"].series
    assert result["gender_chart"].extra.get("show_slice_labels") is True

    assert result["sheet_total"] == 2
    assert result["digital_partner_count"] == 2
    assert result["digital_partner_share_pct"] == 100.0
    share_chart = result["digital_partner_share_chart"]
    assert share_chart.chart_type == "donut"
    assert share_chart.categories == ["Digital partners", "Other"]
    assert share_chart.series[0].data == [2, 0]
    assert share_chart.extra.get("center_total") == 2

    assert len(result["sheet_by_campus"]) == 2
    assert len(result["sheet_by_gender"]) == 2
    assert result["sheet_campus_chart"].categories
    assert result["sheet_gender_chart"].chart_type == "donut"
    assert len(result["sheet_campus_gender_charts"]) == 2
    assert result["sheet_gender_chart"].extra.get("center_total") == 2

    sheet_states = {r["state"]: r["leads"] for r in result["sheet_state_summary"]}
    assert sheet_states.get("Karnataka") == 1
    assert sheet_states.get("Maharashtra") == 1
    assert len(result["adjusted_sheet_state_summary"]) == 2
