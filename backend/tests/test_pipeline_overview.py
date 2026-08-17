"""Isolated pipeline overview: full CRM leads, no journey/master side effects."""

import polars as pl

from app.domain.schema import MASTER_PARQUET_FILE, PIPELINE_CRM_PARQUET_FILE
from app.services.pipeline_overview_service import (
    PIPELINE_RANK,
    PipelineOverviewService,
    furthest_pipeline_key,
    map_lsq_label,
)


def _settings(tmp_path):
    from app.config import Settings

    parquet_dir = tmp_path / "parquet"
    parquet_dir.mkdir(parents=True)
    return Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(parquet_dir),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
        leadsquared_access_key="",
        leadsquared_secret_key="",
        leadsquared_sync_enabled=False,
    )


def test_interview_implies_test_fee_and_ugnet_appeared():
    assert map_lsq_label("uGNET Fee Paid") == "test_fee_paid"
    assert map_lsq_label("Shortlisted for Interview") == "shortlisted"
    key = furthest_pipeline_key(
        contact_stage="Shortlisted for Interview",
        lead_stage="uGNET Fee Paid",
    )
    assert key == "shortlisted"
    rank = PIPELINE_RANK[key]
    assert rank >= PIPELINE_RANK["test_fee_paid"]
    assert rank >= PIPELINE_RANK["ugnet_appeared"]


def test_pipeline_overview_cumulative_counts(tmp_path):
    settings = _settings(tmp_path)
    service = PipelineOverviewService(settings=settings)
    service.ingest_unfiltered_leads(
        pl.DataFrame(
            [
                {
                    "prospect_id": "a",
                    "contact_stage": "Lead Capture",
                    "lead_stage": "Lead Capture",
                },
                {
                    "prospect_id": "b",
                    "contact_stage": "Shortlisted for Interview",
                    "lead_stage": "uGNET Fee Paid",
                },
                {
                    "prospect_id": "c",
                    "contact_stage": "Admission",
                    "lead_stage": "Admission",
                },
            ]
        ),
        replace=True,
    )

    overview = service.get_overview()
    by_key = {step["key"]: step for step in overview["steps"]}
    assert overview["total_leads"] == 3
    assert overview["source"] == "all_crm"
    assert by_key["lead"]["reached"] == 3
    assert by_key["test_fee_paid"]["reached"] == 2
    assert by_key["ugnet_appeared"]["reached"] == 2
    assert by_key["shortlisted"]["reached"] == 2
    assert by_key["admission"]["reached"] == 0
    assert overview["admissions"] == 0
    assert by_key["mql"]["substages"]
    assert any(item["label"] == "Sign Up" for item in by_key["mql"]["substages"])
    assert any(
        item["label"] == "Profile Completed" for item in by_key["sql"]["substages"]
    )


def test_pipeline_counts_all_crm_sources_not_just_digital_partners(tmp_path):
    settings = _settings(tmp_path)
    service = PipelineOverviewService(settings=settings)
    service.ingest_unfiltered_leads(
        pl.DataFrame(
            [
                {
                    "prospect_id": "dp",
                    "contact_stage": "Lead Capture",
                    "lead_stage": "Lead Capture",
                    "source": "Careers360",
                    "partner": "Careers360",
                },
                {
                    "prospect_id": "counsellor",
                    "contact_stage": "Offer Letter Released",
                    "lead_stage": "Interview Completed",
                    "source": "Counsellor",
                    "partner": "Unknown",
                },
                {
                    "prospect_id": "organic",
                    "contact_stage": "Admission",
                    "lead_stage": "Admission",
                    "source": "Organic",
                    "partner": "Unknown",
                },
            ]
        ),
        replace=True,
    )
    overview = service.get_overview()
    assert overview["total_leads"] == 3
    assert overview["admissions"] == 0
    by_key = {step["key"]: step for step in overview["steps"]}
    assert by_key["offer"]["reached"] == 2


def test_pipeline_ignores_master_dataset(tmp_path):
    settings = _settings(tmp_path)
    pl.DataFrame(
        [
            {
                "prospect_id": "only-dp",
                "contact_stage": "Admission",
                "lead_stage": "Admission",
                "partner": "Careers360",
            }
        ]
    ).write_parquet(settings.parquet_dir / MASTER_PARQUET_FILE)

    overview = PipelineOverviewService(settings=settings).get_overview()
    assert overview["total_leads"] == 0
    assert overview["has_data"] is False
    assert overview["lsq_loaded"] is False
    assert not (settings.parquet_dir / PIPELINE_CRM_PARQUET_FILE).exists()


def test_ingest_does_not_write_master(tmp_path):
    settings = _settings(tmp_path)
    service = PipelineOverviewService(settings=settings)
    service.ingest_unfiltered_leads(
        pl.DataFrame(
            [
                {
                    "prospect_id": "x",
                    "contact_stage": "Lead Capture",
                    "lead_stage": "Lead Capture",
                }
            ]
        ),
        replace=True,
    )
    assert (settings.parquet_dir / PIPELINE_CRM_PARQUET_FILE).exists()
    assert not (settings.parquet_dir / MASTER_PARQUET_FILE).exists()


def test_admission_count_comes_from_lms_sheet(tmp_path):
    from app.domain.schema import ADMISSIONS_LMS_PARQUET_FILE

    settings = _settings(tmp_path)
    service = PipelineOverviewService(settings=settings)
    service.ingest_unfiltered_leads(
        pl.DataFrame(
            [
                {
                    "prospect_id": "a",
                    "contact_stage": "Block Amount Paid",
                    "lead_stage": "Block Amount Paid",
                },
                {
                    "prospect_id": "b",
                    "contact_stage": "Admission",
                    "lead_stage": "Admission",
                },
            ]
        ),
        replace=True,
    )
    pl.DataFrame(
        [
            {"status": "Verified", "semester": "1", "email": "one@x.com"},
            {"status": "Verified", "semester": "1", "email": "two@x.com"},
            {"status": "Under Review", "semester": "1", "email": "skip@x.com"},
            {"status": "Verified", "semester": "2", "email": "sem2@x.com"},
        ]
    ).write_parquet(settings.parquet_dir / ADMISSIONS_LMS_PARQUET_FILE)

    overview = service.get_overview()
    by_key = {step["key"]: step for step in overview["steps"]}
    assert overview["lms_loaded"] is True
    assert overview["admissions"] == 2
    assert by_key["admission"]["reached"] == 2
    assert by_key["admission"]["source"] == "lms"
    assert by_key["block"]["reached"] == 2
    assert by_key["admission"]["conversion_from_previous_pct"] == 100.0


def test_pipeline_overview_router_isolated():
    from app.api.routes import admission_journey
    from app.main import create_app

    router_paths = {getattr(route, "path", "") for route in admission_journey.router.routes}
    assert "/admission-journey/pipeline-overview" in router_paths
    assert "/admission-journey/pipeline-overview/sync" in router_paths
    app_paths = {getattr(route, "path", "") for route in create_app().routes}
    assert "/api/v1/admission-journey/pipeline-overview" in app_paths
    assert "/api/v1/admission-journey/pipeline-overview/sync" in app_paths
    assert "/api/v1/admission-journey/students/{journey_id}" in app_paths
