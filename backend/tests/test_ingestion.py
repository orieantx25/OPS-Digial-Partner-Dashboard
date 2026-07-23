"""Backend test suite."""

import io
import tempfile
from datetime import datetime
from pathlib import Path

import polars as pl
import pytest

from app.config import Settings
from app.services.analytics_service import AnalyticsEngine
from app.services.empty_defaults import KPI_DEFINITIONS
from app.services.ingestion_service import IngestionEngine, normalize_header, normalize_partner
from app.infrastructure.duckdb_repo import DuckDBRepository, AnalyticsCache


@pytest.fixture
def temp_settings():
    with tempfile.TemporaryDirectory() as tmp:
        data_dir = Path(tmp)
        settings = Settings(
            data_dir=data_dir,
            parquet_dir=data_dir / "parquet",
            duckdb_path=data_dir / "analytics.duckdb",
            metadata_db_url=f"sqlite:///{data_dir / 'test.db'}",
        )
        settings.ensure_directories()
        yield settings


@pytest.fixture
def sample_csv_bytes():
    df = pl.DataFrame({
        "Prospect ID": ["P001", "P002", "P003"],
        "Name": ["Alice", "Bob", "Carol"],
        "Email": ["alice@test.com", "bob@test.com", "carol@test.com"],
        "Contact Stage": ["1 Dial", "Never Dialed", "2 Dial"],
        "Main Lead Stages": ["MQL", "Lead", "SQL"],
        "Contact Source": ["careers360", "kollegeapply", "college hai"],
        "State": ["Maharashtra", "Karnataka", "Delhi"],
        "Date": ["2024-01-15", "2024-02-20", "2024-03-10"],
        "Total Dialed Count": [1, 0, 2],
        "Connected": [True, False, True],
        "MQL": [True, False, False],
        "SQL": [False, False, True],
        "Application": [False, False, True],
        "Revenue": [0, 0, 50000],
        "Partner Cost": [1000, 2000, 3000],
    })
    buffer = io.BytesIO()
    df.write_csv(buffer)
    return buffer.getvalue()


def test_normalize_header():
    assert normalize_header("Prospect ID") == "prospect_id"
    assert normalize_header("Partner (Auto)") == "partner"
    assert normalize_header("Lead Name") == "name"
    assert normalize_header("Total Interacted Count") == "total_dialed_count"
    assert normalize_header("Date (Auto)") == "date"
    assert normalize_header("Last Activity Date") == "last_activity_date"


def test_normalize_header_date_variants():
    """Any date-like header must resolve to the canonical 'date' column."""
    for header in (
        "Prospect Creation Date",
        "Prospect Creation Date (Auto)",
        "Lead Creation Date",
        "Created On Date",
        "Date (Auto)",
        "Created Date",
    ):
        assert normalize_header(header) == "date", header


def test_minimal_columns_ingest(temp_settings):
    """A sheet with only Prospect ID + a renamed date column should ingest."""
    df = pl.DataFrame({
        "Prospect Creation Date": ["2024-01-15", "2024-02-20"],
        "Prospect ID": ["X1", "X2"],
        "Contact Source": ["careers360", "collegedunia"],
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("minimal.csv", buf.getvalue())])
    assert report.total_rows_accepted == 2, (
        f"Rejected {report.total_rows_rejected}. Issues: {report.issues}"
    )


def test_normalize_partner():
    assert normalize_partner("  partner a ") == "Partner A"


def test_canonical_partner_names():
    """Col J partner variants must collapse to canonical names."""
    assert normalize_partner("careers360") == "Careers360"
    assert normalize_partner("Careers 360") == "Careers360"
    assert normalize_partner("CAREERS360") == "Careers360"
    assert normalize_partner("collegehai") == "College Hai"
    assert normalize_partner("College Hai") == "College Hai"
    assert normalize_partner("kollegeapply") == "Kollege Apply"
    assert normalize_partner("Kollege Apply") == "Kollege Apply"
    assert normalize_partner("collegedunia") == "College Dunia"
    assert normalize_partner("College Dunia") == "College Dunia"
    assert normalize_partner("collegewollege") == "College Wollege"
    assert normalize_partner("College Wollege") == "College Wollege"
    assert normalize_partner(None) is None
    assert normalize_partner("") is None


def test_ingestion_merges_files(temp_settings, sample_csv_bytes):
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("workbook1.csv", sample_csv_bytes)])
    assert report.total_rows_accepted == 3
    assert report.status.value in ("completed", "partial")
    assert engine.duck_repo.get_row_count() == 3


def test_duplicate_detection(temp_settings, sample_csv_bytes):
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    engine.process_upload_batch([("wb1.csv", sample_csv_bytes)])
    report2 = engine.process_upload_batch([("wb2.csv", sample_csv_bytes)])
    assert report2.duplicate_count == 3
    assert engine.duck_repo.get_row_count() == 3


def test_replace_upload(temp_settings, sample_csv_bytes):
    """replace=True must wipe the old MASTER_DATASET and keep only new rows."""
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    engine.process_upload_batch([("wb1.csv", sample_csv_bytes)])
    assert engine.duck_repo.get_row_count() == 3

    df2 = pl.DataFrame({
        "Prospect ID": ["Z1", "Z2"],
        "Name": ["New1", "New2"],
        "Email": ["n1@test.com", "n2@test.com"],
        "Contact Stage": ["1 Dial", "2 Dial"],
        "Main Lead Stages": ["Lead", "MQL"],
        "Contact Source": ["careers360", "college dunia"],
        "State": ["Kerala", "Punjab"],
        "Date": ["2024-05-01", "2024-05-02"],
    })
    buf = io.BytesIO()
    df2.write_csv(buf)
    report = engine.process_upload_batch([("wb2.csv", buf.getvalue())], replace=True)
    assert report.total_rows_accepted == 2
    assert engine.duck_repo.get_row_count() == 2  # old 3 replaced, not 5


def test_incremental_ingestion(temp_settings, sample_csv_bytes):
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    engine.process_upload_batch([("wb1.csv", sample_csv_bytes)])

    df2 = pl.DataFrame({
        "Prospect ID": ["P004"],
        "Name": ["Dave"],
        "Email": ["dave@test.com"],
        "Contact Stage": ["1 Dial"],
        "Main Lead Stages": ["Lead"],
        "Contact Source": ["college wollege"],
        "State": ["Gujarat"],
        "Date": ["2024-04-01"],
    })
    buf = io.BytesIO()
    df2.write_csv(buf)

    report = engine.process_upload_batch([("wb2.csv", buf.getvalue())])
    assert report.total_rows_accepted == 1
    assert engine.duck_repo.get_row_count() == 4


def test_analytics_kpis(temp_settings, sample_csv_bytes):
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    engine.process_upload_batch([("wb.csv", sample_csv_bytes)])

    analytics = AnalyticsEngine(duck_repo=DuckDBRepository(temp_settings), cache=AnalyticsCache())
    from app.domain.models import FilterParams
    kpis = analytics.get_executive_kpis(FilterParams())
    assert len(kpis) >= 10
    assert any(k.key == "total_leads" and k.current == 3 for k in kpis)


def test_empty_dataset_analytics(temp_settings):
    """Dashboard endpoints return empty structures when no data uploaded."""
    analytics = AnalyticsEngine(duck_repo=DuckDBRepository(temp_settings), cache=AnalyticsCache())
    from app.domain.models import FilterParams

    filters = FilterParams()
    kpis = analytics.get_executive_kpis(filters)
    assert len(kpis) == len(KPI_DEFINITIONS)
    assert all(k.current == 0 for k in kpis)

    charts = analytics.get_executive_charts(filters)
    assert "daily_leads" in charts
    assert charts["daily_leads"].categories == []

    funnel = analytics.get_funnel_data(filters)
    assert funnel.series[0].data == [0] * 10

    search = analytics.search_leads(filters)
    assert search.total == 0
    assert search.items == []


def test_excel_datetime_validation(temp_settings):
    """Excel datetime objects must not be rejected as invalid dates."""
    import io
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    headers = [
        "Prospect ID", "Name", "Email", "Contact Stage", "Main Lead Stages",
        "Contact Source", "State", "Date",
    ]
    ws.append(headers)
    ws.append([
        10001, "Test Lead", "test@example.com", "1 Dial", "MQL",
        "careers360", "Maharashtra", datetime(2024, 3, 15),
    ])
    buf = io.BytesIO()
    wb.save(buf)

    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("test.xlsx", buf.getvalue())])
    assert report.total_rows_accepted == 1, f"Expected 1 accepted, got {report.total_rows_rejected} rejected: {report.issues}"


def test_float_prospect_id(temp_settings):
    df = pl.DataFrame({
        "Prospect ID": [12345.0],
        "Name": ["Lead"],
        "Email": ["a@test.com"],
        "Contact Stage": ["1 Dial"],
        "Main Lead Stages": ["Lead"],
        "Contact Source": ["careers360"],
        "State": ["Delhi"],
        "Date": ["2024-01-01"],
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("test.csv", buf.getvalue())])
    assert report.total_rows_accepted == 1


def test_upgrad_sheet_columns(temp_settings):
    """Validate ingestion against upGrad Google Sheets export column layout."""
    df = pl.DataFrame({
        "Prospect ID": ["d0bb98a6-2b99-44ad-8661-f00000000001"],
        "Name": ["Yograj Sarile"],
        "Email": ["yograj@example.com"],
        "Contact Stage": ["DNP"],
        "Main Lead Stage": ["Pre Sign Up"],
        "Contact Source": ["Careers360"],
        "State": ["Maharashtra"],
        "Prospect Creation Date": ["8-May-2026"],
        "Total Dialed Count": [0],
        "Partner (Auto)": ["Careers360"],
        "Date (Auto)": ["8-May-2026"],
        "Week Start (Auto)": ["5-May-2026"],
        "Month (Auto)": ["2026-05"],
        "Connected (Auto)": [0],
        "Mobile Number": ["919876543210"],
        "Persona": [None],
        "Source Medium": ["AP2026"],
        "data source backup": ["kollegeapply"],
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("upgrad_export.csv", buf.getvalue())])
    assert report.total_rows_accepted == 1, (
        f"Expected 1 row, rejected {report.total_rows_rejected}. Issues: {report.issues}"
    )


def test_exact_upgrad_header_order(temp_settings):
    """The exact production header layout (in order) must ingest cleanly."""
    headers = [
        "Prospect ID", "Name", "Email", "Contact Stage", "Main Lead Stages",
        "Contact Source (Fallback)", "State", "Prospect Creation Date",
        "Total Dialed Count", "Partner (Auto)", "Date (Auto)", "Week Start (Auto)",
        "Month (Auto)", "Connected (Auto)", "Mobile Number", "Persona",
        "Source Medium", "data source batch",
    ]
    row = [
        "P-1001", "Yograj Sarile", "yograj@example.com", "DNP", "Pre Sign Up",
        "Careers360", "Maharashtra", "8-May-2026",
        0, "Careers360", "8-May-2026", "5-May-2026",
        "2026-05", 0, "919876543210", None,
        "AP2026", "kollegeapply",
    ]
    df = pl.DataFrame([row], schema=headers, orient="row")
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("prod_export.csv", buf.getvalue())])
    assert report.total_rows_accepted == 1, (
        f"Rejected {report.total_rows_rejected}. Issues: {report.issues}"
    )
    assert engine.duck_repo.get_row_count() == 1


def test_funnel_analytics(temp_settings, sample_csv_bytes):
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    engine.process_upload_batch([("wb.csv", sample_csv_bytes)])

    analytics = AnalyticsEngine(duck_repo=DuckDBRepository(temp_settings))
    from app.domain.models import FilterParams
    funnel = analytics.get_funnel_data(FilterParams())
    assert len(funnel.categories) == 10
    assert funnel.series[0].data[0] == 3


def test_block_amount_paid_from_contact_stage_only(temp_settings):
    """block_amount_paid only from Contact Stage = Block Amount Paid (not lead stage)."""
    df = pl.DataFrame({
        "Prospect ID": ["B1", "B2", "B3", "B4", "B5"],
        "Contact Stage": [
            "Block Amount Paid",
            "Admission",
            "Counseled",
            "Offer Letter Released",
            "Counseled",
        ],
        "Main Lead Stages": [
            "Sign Up",
            "Sign Up",
            "Block Amount Paid",  # lead stage alone must NOT set the flag
            "Block Amount Paid",
            "Sign Up",
        ],
        "Block Amount Paid": [0, 0, 1, 1, 1],
        "Contact Source": ["careers360"] * 5,
        "Date": ["2026-01-01"] * 5,
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("block_contact.csv", buf.getvalue())])
    assert report.total_rows_accepted == 5, report.issues

    rows = engine.duck_repo.query_dicts(
        "SELECT prospect_id, block_amount_paid FROM master_dataset ORDER BY prospect_id",
        [],
    )
    by_id = {r["prospect_id"]: r for r in rows}
    assert by_id["B1"]["block_amount_paid"] is True   # contact stage
    assert by_id["B2"]["block_amount_paid"] is False  # Admission
    assert by_id["B3"]["block_amount_paid"] is False  # lead stage only — ignored
    assert by_id["B4"]["block_amount_paid"] is False  # lead stage only — ignored
    assert by_id["B5"]["block_amount_paid"] is False  # bool alone ignored


def test_lsq_prospect_stage_sets_block_amount_paid(temp_settings):
    """LSQ ProspectStage (CRM Contact Stage) = Block Amount Paid sets the flag."""
    from app.services.leadsquared_mapper import map_leads_to_dataframe

    leads = [
        {
            "ProspectID": "bap-lsq-1",
            "FirstName": "Aarohan",
            "LastName": "prasad",
            "EmailAddress": "aarohan@test.com",
            "Source": "College Hai",
            "CreatedOn": "2026-01-15 10:00:00",
            "ProspectStage": "Block Amount Paid",
            "mx_Main_Lead_Stages": "Offer Letter Released",
            "mx_Contact_Stage": None,
        },
        {
            "ProspectID": "bap-lsq-2",
            "FirstName": "Other",
            "LastName": "Lead",
            "EmailAddress": "other@test.com",
            "Source": "Careers360",
            "CreatedOn": "2026-01-15 10:00:00",
            "ProspectStage": "Counseled",
            "mx_Main_Lead_Stages": "Block Amount Paid",
            "mx_Contact_Stage": None,
        },
    ]
    mapped = map_leads_to_dataframe(leads)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    result = engine.process_lsq_sync_batch(mapped, batch_id="test-bap", replace=True)
    assert result["rows_accepted"] == 2, result

    rows = engine.duck_repo.query_dicts(
        "SELECT prospect_id, contact_stage, lead_stage, block_amount_paid "
        "FROM master_dataset ORDER BY prospect_id",
        [],
    )
    by_id = {r["prospect_id"]: r for r in rows}
    assert by_id["bap-lsq-1"]["contact_stage"] == "Block Amount Paid"
    assert by_id["bap-lsq-1"]["lead_stage"] == "Offer Letter Released"
    assert by_id["bap-lsq-1"]["block_amount_paid"] is True
    assert by_id["bap-lsq-2"]["block_amount_paid"] is False


def test_recompute_block_amount_paid_by_partner(temp_settings):
    """Recompute uses Contact Stage only (exact Block Amount Paid)."""
    df = pl.DataFrame({
        "Prospect ID": ["C1", "C2", "C3", "C4", "C5"],
        "Contact Stage": [
            "Block Amount Paid",
            "Block Amount Paid",
            "Admission",
            "Block Amount Paid",
            "Counseled",
        ],
        "Main Lead Stages": [
            "Sign Up",
            "Sign Up",
            "Block Amount Paid",  # must not count
            "Sign Up",
            "Block Amount Paid",
        ],
        "Contact Source": [
            "kollegeapply",
            "college hai",
            "careers360",
            "collegedunia",
            "college wollege",
        ],
        "Date": ["2026-01-01"] * 5,
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("partners_block.csv", buf.getvalue())])
    assert report.total_rows_accepted == 5, report.issues

    path = temp_settings.parquet_dir / "master_dataset.parquet"
    master = pl.read_parquet(path).with_columns(pl.lit(True).alias("block_amount_paid"))
    master.write_parquet(path)

    stats = engine.recompute_block_amount_paid()
    assert stats["updated"] is True
    assert stats["block_paid_after"] == 3
    by = stats["block_paid_by_partner"]
    assert by.get("Kollege Apply") == 1
    assert by.get("College Hai") == 1
    assert by.get("College Dunia") == 1
    assert "Careers360" not in by
    assert "College Wollege" not in by


def test_stage_to_funnel_mapping():
    """Raw lead/contact stage strings map to the correct funnel stage."""
    from app.domain.schema import stage_to_funnel

    assert stage_to_funnel("Sign Up") == "MQL"
    assert stage_to_funnel("Counseled") == "MQL"
    assert stage_to_funnel("AI Bot Qualified - Hot") == "MQL"
    assert stage_to_funnel("AI Bot Qualified - High Intent") == "MQL"
    assert stage_to_funnel("Profile Completed") == "SQL"
    assert stage_to_funnel("Comprehensive Profile Completed") == "SQL"
    assert stage_to_funnel("uGNET Form Filled") == "Application"
    assert stage_to_funnel("uGNET Fee Paid") == "Test Registration"
    assert stage_to_funnel("uGNET Not Qualified") == "Test Registration"
    assert stage_to_funnel("Interview Qualified") == "Interview"
    assert stage_to_funnel("Shortlisted for Interview") == "Interview"
    assert stage_to_funnel("Provisional OL Sent") == "Offer Letter"
    assert stage_to_funnel("Offer Letter Released") == "Offer Letter"
    assert stage_to_funnel("Block Amount Paid") == "Block Amount Paid"
    assert stage_to_funnel("Never Picked Up") == "Lead"
    assert stage_to_funnel("NA") == "Lead"
    assert stage_to_funnel(None) == "Lead"
    assert stage_to_funnel("") == "Lead"
    # unseen variant resolved by keyword fallback
    assert stage_to_funnel("uGNET Re-Scheduled") == "Test Registration"


def test_funnel_derivation_from_text_stages(temp_settings):
    """Real workbooks have no boolean flags; the funnel must be derived from
    the text lead/contact stages, taking the furthest stage reached."""
    df = pl.DataFrame({
        "Prospect ID": ["A1", "A2", "A3", "A4", "A5"],
        "Contact Stage": [
            "Counseled", "Provisional OL Sent", "Block Amount Paid",
            "Never Picked Up", "uGNET Fee Paid",
        ],
        "Main Lead Stages": [
            "Sign Up", "Interview Qualified", "Offer Letter Released",
            "Pre Sign Up", "uGNET Scheduled",
        ],
        "Contact Source": ["careers360"] * 5,
        "Connected (Auto)": [0, 0, 0, 0, 0],
        "Date": ["2026-01-01"] * 5,
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("stages.csv", buf.getvalue())])
    assert report.total_rows_accepted == 5, report.issues

    analytics = AnalyticsEngine(duck_repo=DuckDBRepository(temp_settings))
    from app.domain.models import FilterParams
    funnel = analytics.get_funnel_data(FilterParams())
    # ranks: A1=MQL(3) A2=OfferLetter(8) A3=Block(9) A4=Lead(1) A5=TestReg(6)
    assert funnel.series[0].data == [5, 4, 4, 3, 3, 3, 2, 2, 1, 0]

    rows = engine.duck_repo.query_dicts(
        "SELECT prospect_id, funnel_stage FROM master_dataset ORDER BY prospect_id", []
    )
    stage_by_id = {r["prospect_id"]: r["funnel_stage"] for r in rows}
    assert stage_by_id == {
        "A1": "MQL",
        "A2": "Offer Letter",
        "A3": "Block Amount Paid",
        "A4": "Lead",
        "A5": "Test Registration",
    }

    contact_rows = engine.duck_repo.query_dicts(
        "SELECT connected, contactability FROM master_dataset", []
    )
    for r in contact_rows:
        expected = "Contactable" if r["connected"] else "Not Contactable"
        assert r["contactability"] == expected

    analytics = AnalyticsEngine(duck_repo=DuckDBRepository(temp_settings))
    from app.domain.models import FilterParams
    trend = analytics.get_contactability_trend(FilterParams())
    assert any(float(v) > 0 for v in trend.series[0].data)


def test_vectorized_validation_counts(temp_settings):
    """Vectorized validation must classify blanks, duplicates and bad dates the
    same way the old per-row loop did, and dedupe accepted rows in the master."""
    df = pl.DataFrame({
        "Prospect ID": ["P1", "P2", "P2", "", "P3", "P4"],
        "Main Lead Stages": ["Sign Up"] * 6,
        "Contact Source": ["careers360"] * 6,
        "Date": [
            "2026-01-01", "2026-01-02", "2026-01-03",
            "2026-01-04", "not-a-date", "2026-01-06",
        ],
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("v.csv", buf.getvalue())])

    # P1, P2(first occurrence), P4 accepted; P2(dup), blank id, P3(bad date) rejected.
    assert report.total_rows_accepted == 3, report.rejection_summary
    assert report.total_rows_rejected == 3
    assert report.rejection_summary.get("blank_prospect_id") == 1
    assert report.rejection_summary.get("duplicate_prospect_id") == 1
    assert report.rejection_summary.get("invalid_date") == 1
    assert engine.duck_repo.get_row_count() == 3


def test_blank_date_is_accepted(temp_settings):
    """A blank date is allowed (only non-blank unparseable dates are rejected)."""
    df = pl.DataFrame({
        "Prospect ID": ["Q1", "Q2"],
        "Main Lead Stages": ["Sign Up", "Sign Up"],
        "Contact Source": ["careers360", "kollegeapply"],
        "Date": ["", "2026-02-01"],
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("b.csv", buf.getvalue())])
    assert report.total_rows_accepted == 2, report.rejection_summary


def test_ai_bot_contact_stage_outcomes():
    from app.domain.schema import ai_outcomes_from_contact_stage, is_ai_bot_contact_stage

    assert is_ai_bot_contact_stage("AI Bot Qualified - Hot")
    assert not is_ai_bot_contact_stage("Counseled")

    warm = ai_outcomes_from_contact_stage("AI Bot Qualified - Warm")
    assert warm["ai_contacted"] and warm["ai_warm"] and warm["ai_qualified"]

    dnp = ai_outcomes_from_contact_stage("AI Bot Reached - DNP")
    assert dnp["ai_contacted"] and dnp["dnp"]

    low = ai_outcomes_from_contact_stage("AI Bot Qualified - Low Interest")
    assert low["ai_contacted"]
    assert not low["ai_qualified"]


def test_connected_ai_ac_bifurcation(temp_settings):
    """Connected includes AI bot calling and splits into AI Connected vs AC Connected."""
    df = pl.DataFrame({
        "Prospect ID": ["C1", "C2", "C3", "C4", "C5", "C6"],
        "Contact Stage": [
            "AI Bot Called - Not Interested",
            "AI Bot Reached - DNP",
            "Not Interested",
            "Call Back Later",
            "AI Bot Qualified - Warm",
            "Not Interested",
        ],
        "Main Lead Stages": [
            "Pre Sign Up",
            "Lead Capture",
            "Pre Sign Up",
            "Pre Sign Up",
            "Sign Up",
            "Lead Capture",
        ],
        "Contact Source": ["careers360"] * 6,
        "Last Activity": [
            "Called",
            "Lead Capture",
            "Called",
            "Called",
            "Called",
            "Called",
        ],
        "Date": ["2026-01-01"] * 6,
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("connected_split.csv", buf.getvalue())])
    assert report.total_rows_accepted == 6, report.issues

    rows = engine.duck_repo.query_dicts(
        "SELECT prospect_id, connected, ai_contacted, funnel_stage "
        "FROM master_dataset ORDER BY prospect_id",
        [],
    )
    by_id = {r["prospect_id"]: r for r in rows}
    # AI calling (not DNP) counts as Connected
    assert by_id["C1"]["connected"] and by_id["C1"]["ai_contacted"]
    assert by_id["C1"]["funnel_stage"] == "Connected"
    # DNP stays Lead / not connected
    assert not by_id["C2"]["connected"]
    assert by_id["C2"]["funnel_stage"] == "Lead"
    # Human AC connected
    assert by_id["C3"]["connected"] and not by_id["C3"]["ai_contacted"]
    assert by_id["C4"]["connected"] and not by_id["C4"]["ai_contacted"]
    # AI MQL still connected + AI
    assert by_id["C5"]["connected"] and by_id["C5"]["ai_contacted"]
    assert by_id["C5"]["funnel_stage"] == "MQL"
    # Connected but tagged Lead Capture → excluded from AC Connected
    assert by_id["C6"]["connected"] and not by_id["C6"]["ai_contacted"]

    analytics = AnalyticsEngine(duck_repo=DuckDBRepository(temp_settings))
    from app.domain.models import FilterParams

    funnel = analytics.get_funnel_data(FilterParams())
    split = funnel.extra["connected_split"]
    assert split["ai_connected"] == 2  # C1, C5
    assert split["ac_connected"] == 2  # C3, C4 (C6 excluded for lead capture)

    kpis = {m.key: m.current for m in analytics.get_executive_kpis(FilterParams())}
    assert kpis["connected"] == 5  # C1, C3, C4, C5, C6
    assert kpis["ai_connected"] == 2
    assert kpis["ac_connected"] == 2

    ai_search = analytics.search_leads(
        FilterParams(lead_filter="ai_connected"), page=1, page_size=50
    )
    assert ai_search.total == 2
    ac_search = analytics.search_leads(
        FilterParams(lead_filter="ac_connected"), page=1, page_size=50
    )
    assert ac_search.total == 2


def test_new_production_header_layout(temp_settings):
    """Full production header layout from Google Sheets export."""
    headers = [
        "Prospect ID", "Email", "Lead Name", "Contact Stage", "State", "Mobile Number",
        "Main Lead Stages", "Prospect Creation Date", "Last Activity Date", "Last Activity",
        "Total Interacted Count", "Contact Source", "Created On", "Persona", "Source Medium",
        "data source batch", "Prospect Creation Date (Auto)", "Date (Auto)",
        "Week Start (Auto)", "Month (Auto)",
    ]
    row = [
        "P-9001", "lead@example.com", "Test Lead", "1 Dial", "Maharashtra", "919876543210",
        "Sign Up", "bad-date", "2026-06-01", "Called", 2, "Careers360 Lead", "2026-01-01",
        "Student", "AP2026", "batch-jan", "bad-date", "8-May-2026", "5-May-2026", "2026-05",
    ]
    df = pl.DataFrame([row], schema=headers, orient="row")
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("prod_layout.csv", buf.getvalue())])
    assert report.total_rows_accepted == 1, (
        f"Rejected {report.total_rows_rejected}. Summary: {report.rejection_summary}"
    )
    rows = engine.duck_repo.query_dicts(
        "SELECT partner, campaign, total_dialed_count FROM master_dataset", []
    )
    assert rows[0]["partner"] == "Careers360"
    assert rows[0]["campaign"] == "batch-jan"
    assert rows[0]["total_dialed_count"] == 2


def test_date_auto_priority_over_other_date_columns(temp_settings):
    headers = ["Prospect ID", "Prospect Creation Date", "Date (Auto)", "Main Lead Stages", "Contact Source"]
    row = ["X1", "not-a-valid-date", "8-May-2026", "Sign Up", "careers360"]
    df = pl.DataFrame([row], schema=headers, orient="row")
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("dates.csv", buf.getvalue())])
    assert report.total_rows_accepted == 1, report.rejection_summary


def test_excel_serial_date(temp_settings):
    df = pl.DataFrame({
        "Prospect ID": ["S1"],
        "Main Lead Stages": ["Sign Up"],
        "Contact Source": ["careers360"],
        "Date (Auto)": [45321.0],
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("serial.csv", buf.getvalue())])
    assert report.total_rows_accepted == 1, report.rejection_summary


def test_derive_partner_from_source():
    from app.domain.schema import derive_partner_from_source

    assert derive_partner_from_source("kollegeapply AP") == "Kollege Apply"
    assert derive_partner_from_source("College Hai leads") == "College Hai"
    assert derive_partner_from_source("careers360") == "Careers360"
    assert derive_partner_from_source("random source") == "Unknown"


def test_is_digital_partner():
    from app.domain.schema import is_digital_partner

    assert is_digital_partner("Careers360") is True
    assert is_digital_partner("Kollege Apply") is True
    assert is_digital_partner("Unknown") is False
    assert is_digital_partner(None) is False
    assert is_digital_partner("") is False


def test_college_wollege_campaign_includes_medium(temp_settings):
    headers = [
        "Prospect ID", "Contact Source", "Source Medium", "data source batch",
        "Date (Auto)", "Main Lead Stages",
    ]
    row = ["CW1", "College Wollege FB", "Meta", "batch-42", "8-May-2026", "Sign Up"]
    df = pl.DataFrame([row], schema=headers, orient="row")
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("cw.csv", buf.getvalue())])
    assert report.total_rows_accepted == 1, report.rejection_summary
    rows = engine.duck_repo.query_dicts("SELECT campaign FROM master_dataset", [])
    assert rows[0]["campaign"] == "batch-42 | Meta"


def test_leads_not_touched_kpi_uses_last_activity(temp_settings):
    """Leads not Touched = Last Activity is Lead Capture (not dial count)."""
    df = pl.DataFrame({
        "Prospect ID": ["L1", "L2", "L3"],
        "Main Lead Stages": ["Sign Up", "Sign Up", "Sign Up"],
        "Contact Source": ["careers360", "college hai", "collegedunia"],
        "Date (Auto)": ["8-May-2026", "8-May-2026", "8-May-2026"],
        "Last Activity": ["Lead Capture", "Called", "lead capture"],
        "Total Interacted Count": [0, 0, 5],
    })
    buf = io.BytesIO()
    df.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("touch.csv", buf.getvalue())])
    assert report.total_rows_accepted == 3

    analytics = AnalyticsEngine(duck_repo=DuckDBRepository(temp_settings))
    from app.domain.models import FilterParams
    kpis = analytics.get_executive_kpis(FilterParams())
    touch = next(k for k in kpis if k.key == "never_dialed")
    assert touch.label == "Leads not Touched"
    assert touch.current == 2  # L1 and L3 — L2 has Last Activity = Called


def test_failed_replace_upload_preserves_existing_data(temp_settings, sample_csv_bytes):
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    engine.process_upload_batch([("good.csv", sample_csv_bytes)])
    assert engine.duck_repo.get_row_count() == 3

    bad = pl.DataFrame({
        "Prospect ID": ["Z1", "Z2"],
        "Main Lead Stages": ["Sign Up", "Sign Up"],
        "Prospect Creation Date": ["bad", "bad"],
        "Date (Auto)": ["also-bad", "also-bad"],
    })
    buf = io.BytesIO()
    bad.write_csv(buf)
    report = engine.process_upload_batch([("bad.csv", buf.getvalue())], replace=True)
    assert report.total_rows_accepted == 0
    assert engine.duck_repo.get_row_count() == 3


def test_persona_last_24h_created_includes_kollege(temp_settings):
    """Created last 24h includes Kollege; Other Persona = non-blank non-B.Tech; no activity → interested 0."""
    from datetime import datetime, timedelta

    from app.domain.models import FilterParams

    now = datetime.utcnow()
    recent = (now - timedelta(hours=6)).strftime("%Y-%m-%d %H:%M:%S")
    old = (now - timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")

    master = pl.DataFrame({
        "Prospect ID": ["p1", "p2", "p3", "p4", "p5"],
        "Email": [
            "a@test.com",
            "b@test.com",
            "c@test.com",
            "d@test.com",
            "e@test.com",
        ],
        "Main Lead Stages": ["Sign Up"] * 5,
        "Persona": [
            "Know More about B.Tech",
            "Know More about B.Tech",
            "Know More about B.Tech",
            "Career Explorer",
            "",
        ],
        "Contact Source": [
            "Careers360",
            "Kollege Apply",
            "College Hai",
            "Careers360",
            "College Dunia",
        ],
        "Date": [recent, recent, old, recent, recent],
    })
    buf = io.BytesIO()
    master.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("master.csv", buf.getvalue())])
    assert report.total_rows_accepted == 5, report.issues

    analytics = AnalyticsEngine(duck_repo=DuckDBRepository(temp_settings))
    result = analytics.get_persona_analytics(FilterParams())

    assert result["summary"]["know_more_about_btech"] == 3
    assert result["summary"]["other_persona"] == 1
    assert result["summary"]["know_more_about_btech_last_24h"] == 0
    # Created incl Kollege = p1, p2, p4, p5 (not p3 old)
    assert result["summary"]["created_last_24h"] == 4
    chart = result["charts"]["stage_last_24h"]
    assert chart.chart_type == "pie"
    assert chart.series[0].data == [4, 0]


def test_persona_activity_created_vs_interested(temp_settings):
    """Last 24h Interested = Know More event + activity_date in 24h; Kollege included."""
    from datetime import datetime, timedelta

    from app.domain.models import FilterParams
    from app.services.persona_activity_service import PersonaActivityService

    now = datetime.utcnow()
    recent = now.strftime("%Y-%m-%d %H:%M:%S")
    act_recent = (now - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")
    act_old = (now - timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S")

    master = pl.DataFrame({
        "Prospect ID": [
            "fa6ad873-3364-478a-85f7-3411c8e4c643",
            "other-id",
            "third-id",
            "kollege-id",
            "wrong-event-id",
        ],
        "Email": [
            "archanadattatrygaikwad1987@gmail.com",
            "match-by-email@test.com",
            "nomatch@test.com",
            "kollege@test.com",
            "wrong@test.com",
        ],
        "Main Lead Stages": ["Sign Up"] * 5,
        "Persona": [
            "Know More about B. Tech",
            "Know More about B.Tech",
            "Career Explorer",
            "Know More about B.Tech",
            "Know More about B.Tech",
        ],
        "Contact Source": [
            "Careers360",
            "College Hai",
            "College Dunia",
            "Kollege Apply",
            "Careers360",
        ],
        "Date": [recent] * 5,
    })
    buf = io.BytesIO()
    master.write_csv(buf)
    engine = IngestionEngine(settings=temp_settings, duck_repo=DuckDBRepository(temp_settings))
    report = engine.process_upload_batch([("master.csv", buf.getvalue())])
    assert report.total_rows_accepted == 5, report.issues

    activity = pl.DataFrame({
        "Prospect Id": [
            "fa6ad873-3364-478a-85f7-3411c8e4c643",
            "",
            "missing-id",
            "kollege-id",
            "wrong-event-id",
            "fa6ad873-3364-478a-85f7-3411c8e4c643",
        ],
        "Email Address": [
            "archanadattatrygaikwad1987@gmail.com",
            "match-by-email@test.com",
            "nobody@test.com",
            "kollege@test.com",
            "wrong@test.com",
            "archanadattatrygaikwad1987@gmail.com",
        ],
        "Phone Number": [""] * 6,
        "Contact Name": ["Archana", "Email Match", "Nobody", "Kollege", "Wrong", "Old"],
        "Activity Id": ["a1", "a2", "a3", "a4", "a5", "a6"],
        "Activity Date": [
            act_recent,
            act_recent,
            act_recent,
            act_recent,
            act_recent,
            act_old,
        ],
        "Activity Modified On": [act_recent] * 6,
        "Notes": [
            "Know More about B.Tech",
            "Know More about B. Tech",
            "Know More about B.Tech",
            "Know More about B.Tech",
            "Lead Capture",
            "Know More about B.Tech",
        ],
    })
    act_buf = io.BytesIO()
    activity.write_csv(act_buf)
    svc = PersonaActivityService(
        duck_repo=DuckDBRepository(temp_settings), settings=temp_settings
    )
    upload = svc.upload_sheet("persona_24h.csv", act_buf.getvalue())
    assert upload["row_count"] == 6

    analytics = AnalyticsEngine(duck_repo=DuckDBRepository(temp_settings))
    result = analytics.get_persona_analytics(FilterParams())
    assert result["summary"]["created_last_24h"] == 5
    # Matches: prospect id, email match, kollege — not missing-id, not wrong event, not old activity
    assert result["summary"]["know_more_about_btech_last_24h"] == 3
    assert result["charts"]["stage_last_24h"].series[0].data == [5, 3]
    assert sum(result["charts"]["partner_last_24h"].series[0].data) == 3
    assert upload["row_count"] == 6
