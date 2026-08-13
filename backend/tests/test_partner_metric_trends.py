"""Tests for multi-partner metric trends."""

import io

import polars as pl

from app.domain.models import FilterParams
from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
from app.services.analytics_service import AnalyticsEngine
from app.services.ingestion_service import IngestionEngine


def test_partner_metric_trends_weekly(temp_settings):
    master = pl.DataFrame({
        "Prospect ID": ["p1", "p2", "p3", "p4", "p5", "p6"],
        "Main Lead Stages": ["Sign Up"] * 6,
        "Contact Source": [
            "Careers360",
            "Careers360",
            "College Dunia",
            "College Dunia",
            "College Hai",
            "College Hai",
        ],
        "Contact Stage": [
            "Lead",
            "Test Registration",
            "Lead",
            "Block Amount Paid",
            "Test Registration",
            "Lead",
        ],
        "Date": [
            "2026-08-03",
            "2026-08-04",
            "2026-08-03",
            "2026-08-10",
            "2026-08-11",
            "2026-08-12",
        ],
    })
    buf = io.BytesIO()
    master.write_csv(buf)
    ingest = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    ingest.process_upload_batch([("master.csv", buf.getvalue())])

    analytics = AnalyticsEngine(
        duck_repo=DuckDBRepository(temp_settings), cache=AnalyticsCache(ttl_seconds=0)
    )
    result = analytics.get_partner_metric_trends(FilterParams(), grain="weekly")

    assert result["grain"] == "weekly"
    assert len(result["partners"]) >= 2
    assert "Careers360" in result["partners"]
    assert "College Dunia" in result["partners"]
    assert len(result["periods"]) >= 1

    leads_chart = result["charts"]["leads"]
    assert leads_chart.chart_type == "line"
    assert len(leads_chart.categories) == len(result["periods"])
    assert len(leads_chart.series) == len(result["partners"])
    assert sum(sum(s.data) for s in leads_chart.series) == 6

    test_chart = result["charts"]["test_takers"]
    block_chart = result["charts"]["block_amount"]
    assert sum(sum(s.data) for s in test_chart.series) >= 1
    assert sum(sum(s.data) for s in block_chart.series) >= 1


def test_partner_metric_trends_empty_without_data(temp_settings):
    analytics = AnalyticsEngine(
        duck_repo=DuckDBRepository(temp_settings), cache=AnalyticsCache(ttl_seconds=0)
    )
    result = analytics.get_partner_metric_trends(FilterParams(), grain="daily")
    assert result["periods"] == []
    assert result["partners"] == []
    assert result["charts"]["leads"].series == []
