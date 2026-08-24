"""Admission journey isolation, matching, clash cutoff, and list/detail shape."""

from datetime import date

import polars as pl

from app.domain.schema import MASTER_PARQUET_FILE
from app.services.admission_journey_service import (
    AdmissionJourneyService,
    CHANNEL_COUNSELLOR,
    CHANNEL_DIGITAL_PARTNER,
    CHANNEL_UNMATCHED,
    build_journey_events,
    classify_channel,
    classify_lead_clash,
    format_clash_at_with,
    is_counsellor_clash,
    make_journey_id,
    parse_event_datetime,
    resolve_block_payment_status,
)
from app.services.admissions_service import AdmissionsService
from app.services.analytics_service import BLOCK_CLASH_LEAD_CUTOFF
from app.services.block_payment_service import BlockPaymentService


class FakeLSQ:
    def __init__(self, leads_by_lookup):
        self.leads_by_lookup = leads_by_lookup
        self.calls = []

    def fetch_leads_by_lookup(self, lookup_name, lookup_value, include_csv, page_size=None):
        self.calls.append((lookup_name, lookup_value))
        return list(self.leads_by_lookup.get((lookup_name, lookup_value), []))


def _settings(tmp_path):
    from app.config import Settings

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
        leadsquared_access_key="",
        leadsquared_secret_key="",
        leadsquared_sync_enabled=False,
    )
    (tmp_path / "parquet").mkdir(parents=True)
    return settings


def _seed_sheets(settings):
    block_svc = BlockPaymentService(settings=settings)
    adm_svc = AdmissionsService(settings=settings)

    block_svc.upload_sheet(
        "block.csv",
        b"Email,Phone,CollegeCode,CollegeName,Contact Source,"
        b"Original UTM: UTM Medium,Original UTM: UTM Campaign,UTM Activity,"
        b"Source at Payment,Campaign at Payment,Recent UTM\n"
        b"clash@example.com,9000000001,ADYPU,ADYPU Pune,Careers360,"
        b"cpc,careers360-spring,visit-1,Counsellor,walk-in,retarget\n"
        b"after@example.com,9000000002,SSAHE,SSAHE Tumkur,College Hai,"
        b"cpc,collegehai,visit-2,Counsellor,campus,recent-hai\n"
        b"organic@example.com,9000000003,ADYPU,ADYPU Pune,Organic,"
        b"organic,none,none,Website,home,organic\n"
        b"ugnet@example.com,9000000005,ADYPU,ADYPU Pune,Careers360,"
        b"cpc,careers360-spring,ugnet-otp,Website,ugnet one time,recent-ugnet\n",
    )
    adm_svc.upload_sheet(
        "admissions.csv",
        b"ID,Student Name,Email,Phone,University,Semester I Amount Payment Status,"
        b"AmountInr,Paid,PaidAt,CreatedAt,UpdatedAt\n"
        b"1,Clash Lead,clash@example.com,9000000001,ADYPU,Paid,10000,true,2026-05-10,2026-04-01,2026-05-11\n"
        b"2,After Cutoff,after@example.com,9000000002,SSAHE,Paid,12000,true,2026-06-10,2026-06-01,2026-06-11\n"
        b"3,Organic Unmatched,organic@example.com,9000000003,ADYPU,Pending,0,false,,,\n"
        b"4,Phone Only,phoneonly@example.com,9000000004,SSAHE,Paid,8000,true,2026-04-01,2026-03-15,2026-04-02\n"
        b"5,Ugnet Lead,ugnet@example.com,9000000005,ADYPU,Paid,15000,true,2026-06-20,2026-05-01,2026-06-21\n",
    )
    lms_csv = (
        b"Candidate Name,Candidate Email,Phone,Campus,Semester,Status,"
        b"Payable (INR),Verified Paid (INR),Submitted On,Paid On,Verified On\n"
        b"Clash Lead,clash@example.com,9000000001,ADYPU,1,Verified,100000,100000,"
        b"2026-05-08,2026-05-09,2026-05-12\n"
    )
    raw = adm_svc._read_file("lms.csv", lms_csv)
    frame = adm_svc._normalize_lms_frame(raw, "lms.csv")
    adm_svc._write_lms_frame(frame, "lms.csv")
    return adm_svc


def test_resolve_block_payment_status_prefers_sheet_then_above_500_rule():
    assert resolve_block_payment_status("Full Payment", "100") == "Full Payment"
    assert resolve_block_payment_status("Partial Payment", "50000") == "Partial Payment"
    assert resolve_block_payment_status(None, "50000") == "Full Payment"
    assert resolve_block_payment_status("", "5000") == "Full Payment"
    assert resolve_block_payment_status("Paid", "501") == "Full Payment"
    assert resolve_block_payment_status("Paid", "500") == "Partial Payment"
    assert resolve_block_payment_status(None, "100") == "Partial Payment"
    assert resolve_block_payment_status(None, None) is None


def test_classify_channel_and_clash_cutoff():
    assert classify_channel(False, "Careers360", "Counsellor") == CHANNEL_UNMATCHED
    assert classify_channel(True, "Careers360", "Counsellor") == CHANNEL_COUNSELLOR
    assert (
        classify_channel(True, "Careers360", "Digital Partner") == CHANNEL_DIGITAL_PARTNER
    )
    assert (
        classify_channel(
            True,
            "Careers360",
            "Counsellor",
            "cpc",
            "careers360-spring",
            created_on="2026-05-01",
        )
        == CHANNEL_DIGITAL_PARTNER
    )
    # source_at_payment="Website" → not a clash even if campaign says Counsellor
    assert not is_counsellor_clash(
        "Website",
        "Website",
        "cpc",
        "careers360-spring",
        "2026-05-01",
        campaign_at_payment="Counsellor walk-in",
        on_block_sheet=True,
    )
    # source_at_payment="Counsellor" → clash
    assert is_counsellor_clash(
        "Counsellor",
        "Careers360",
        "cpc",
        "careers360-spring",
        "2026-05-01",
        on_block_sheet=True,
    )
    # source_at_payment="Sales" is captured but not a clash
    assert not is_counsellor_clash(
        "Sales team",
        "Careers360",
        "cpc",
        "careers360-spring",
        "2026-05-01",
        on_block_sheet=True,
    )
    # source_at_payment="Website" is NOT a clash source
    ugnet = classify_lead_clash(
        lsq_source="Careers360",
        original_utm_campaign="careers360-spring",
        original_utm_medium="cpc",
        source_at_payment="Website",
        campaign_at_payment="ugnet one time",
        created_on="2026-05-01",
        paid_at="2026-06-20",
        lsq_prospect_stage="uGNET Fee Paid",
        lsq_test_registration="2026-06-15",
        sheet_is_paid=True,
        on_block_sheet=True,
    )
    assert ugnet.is_clash is False

    # source_at_payment="Counsellor" IS a clash source
    paid_before = classify_lead_clash(
        lsq_source="Website",
        original_utm_campaign="collegehai-summer",
        source_at_payment="Counsellor",
        created_on="2026-06-10",
        paid_at="2026-05-20",
        on_block_sheet=True,
    )
    assert paid_before.is_clash is True
    assert paid_before.clash_at_block is True
    assert paid_before.clash_at_admission is False

    # source_at_payment="Counsellor" + reached admission via LMS
    block_then_admission = classify_lead_clash(
        lsq_source="Careers360",
        original_utm_campaign="careers360-spring",
        source_at_payment="Counsellor",
        created_on="2026-05-01",
        sheet_is_paid=False,
        lms_status="Under Review",
        lms_submitted_on="2026-07-01",
        on_block_sheet=True,
    )
    assert block_then_admission.clash_at_block is True
    assert block_then_admission.clash_at_admission is True

    # source_at_payment="Sales" is captured but is NOT a clash
    sales_clash = classify_lead_clash(
        lsq_source="Careers360",
        original_utm_campaign="careers360-spring",
        source_at_payment="Sales",
        created_on="2026-05-01",
        sheet_is_paid=True,
        on_block_sheet=True,
    )
    assert sales_clash.is_clash is False
    assert sales_clash.clash_at_admission is False

    # source_at_payment="Influencer" IS a clash source
    influencer_clash = classify_lead_clash(
        lsq_source="College Dunia",
        original_utm_campaign="collegedunia-summer",
        source_at_payment="Influencer referral",
        created_on="2026-05-01",
        sheet_is_paid=True,
        on_block_sheet=True,
    )
    assert influencer_clash.is_clash is True

    # source_at_payment="google" is NOT a clash source (organic)
    organic = classify_lead_clash(
        lsq_source="Careers360",
        original_utm_campaign="careers360-spring",
        source_at_payment="google",
        created_on="2026-05-01",
        sheet_is_paid=True,
        on_block_sheet=True,
    )
    assert organic.is_clash is False

    assert BLOCK_CLASH_LEAD_CUTOFF == date(2026, 6, 6)
    # Under new rules: clash is based on source_at_payment only, not date
    assert is_counsellor_clash(
        "Counsellor", "Careers360", "cpc", "careers360-spring", "2026-05-01"
    )
    # Counsellor is still a clash even after cutoff date
    assert is_counsellor_clash(
        "Counsellor", "Careers360", "cpc", "careers360-spring", "2026-06-06"
    )
    assert is_counsellor_clash(
        "Counsellor", "Careers360", "cpc", "careers360-spring", "2026-07-01"
    )
    # Website is NOT a clash source
    assert not is_counsellor_clash(
        "Website", "Careers360", "cpc", "x", "2026-05-01"
    )
    label = format_clash_at_with(
        clash=True,
        clash_at_block=True,
        clash_at_admission=True,
        lsq_source="Careers360",
        original_utm_campaign="careers360-spring",
        source_at_payment="Counsellor",
    )
    assert label == "Block · Admission · Counsellor | Careers360"
    assert format_clash_at_with(
        clash=False,
        clash_at_block=False,
        clash_at_admission=False,
    ) is None


def test_email_and_phone_last10_match_and_inclusion(tmp_path):
    settings = _settings(tmp_path)
    _seed_sheets(settings)

    fake = FakeLSQ(
        {
            ("EmailAddress", "clash@example.com"): [
                {
                    "ProspectID": "p-clash",
                    "EmailAddress": "clash@example.com",
                    "Source": "Careers360",
                    "SourceMedium": "cpc",
                    "SourceCampaign": "careers360-spring",
                    "ProspectStage": "Block Amount Paid",
                    "mx_Main_Lead_Stages": "Offer Letter Released",
                    "CreatedOn": "2026-05-01 10:00:00",
                    "ModifiedOn": "2026-05-20 14:00:00",
                }
            ],
            ("EmailAddress", "after@example.com"): [
                {
                    "ProspectID": "p-after",
                    "EmailAddress": "after@example.com",
                    "Source": "College Hai",
                    "ProspectStage": "Connected",
                    "CreatedOn": "2026-06-06 09:00:00",
                }
            ],
            ("Phone", "9000000004"): [
                {
                    "ProspectID": "p-phone",
                    "Phone": "919000000004",
                    "Source": "College Dunia",
                    "ProspectStage": "MQL",
                    "CreatedOn": "2026-03-01 08:00:00",
                }
            ],
            ("EmailAddress", "ugnet@example.com"): [
                {
                    "ProspectID": "p-ugnet",
                    "EmailAddress": "ugnet@example.com",
                    "Source": "Careers360",
                    "SourceMedium": "cpc",
                    "SourceCampaign": "careers360-spring",
                    "ProspectStage": "uGNET Fee Paid",
                    "mx_Test_Registration": "2026-06-15",
                    "CreatedOn": "2026-05-01 09:00:00",
                    "ModifiedOn": "2026-06-16 11:00:00",
                }
            ],
        }
    )
    service = AdmissionJourneyService(settings=settings, lsq_client=fake)
    result = service.sync()
    assert result["status"] == "completed"
    assert result["total"] == 5
    assert result["synced"] == 5
    assert result["unmatched_lsq"] == 1

    listed = service.list_students(page=1, page_size=50)
    assert listed["total"] == 5
    emails = {row["email"] for row in listed["items"]}
    assert "organic@example.com" in emails
    assert "clash@example.com" in emails

    status = service.get_status()
    # clash@example.com (Counsellor) + after@example.com (Counsellor) = 2 clashes
    # ugnet@example.com has source_at_payment="Website" → not a clash under new rules
    assert status["clash_count"] == 2
    assert status["clash_at_block"] == 1  # only clash@ (before cutoff + on block sheet)
    assert status["clash_at_admission"] == 2  # clash@ + after@ (both reached admission)
    assert status["dp_count"] >= 1

    organic = next(r for r in listed["items"] if r["email"] == "organic@example.com")
    assert organic["channel"] == CHANNEL_UNMATCHED
    assert organic["lsq_matched"] is False
    assert organic["is_clash"] is False

    clash = next(r for r in listed["items"] if r["email"] == "clash@example.com")
    assert clash["is_clash"] is True
    assert clash["clash_at_block"] is True
    assert clash["clash_at_admission"] is True
    assert clash["channel"] == CHANNEL_DIGITAL_PARTNER
    assert clash["original_utm_campaign"] == "careers360-spring"

    after = next(r for r in listed["items"] if r["email"] == "after@example.com")
    # source_at_payment="Counsellor" → clash; paid on sheet → clash_at_admission
    assert after["is_clash"] is True
    assert after["clash_at_admission"] is True

    ugnet = next(r for r in listed["items"] if r["email"] == "ugnet@example.com")
    # source_at_payment="Website" → NOT a clash source
    assert ugnet["is_clash"] is False
    assert ugnet["campaign_at_payment"]

    phone_row = next(r for r in listed["items"] if r["email"] == "phoneonly@example.com")
    assert phone_row["lsq_matched"] is True
    assert ("Phone", "9000000004") in fake.calls

    detail = service.get_student(organic["journey_id"])
    assert detail is not None
    assert detail["header"]["unmatched_lsq"] is True
    assert [step["key"] for step in detail["path"]] == [
        "created",
        "contact_source",
        "original_utm",
        "utm_activity",
        "lsq_stage",
        "payment_source",
        "amounts",
        "recent_utm",
        "campus",
    ]
    assert [chip["key"] for chip in detail["stages"]] == [
        "created",
        "pipeline",
        "offer",
        "block",
        "sem",
    ]

    clash_detail = service.get_student(clash["journey_id"])
    assert clash_detail["header"]["clash"] is True
    assert clash_detail["header"]["clash_at_block"] is True
    assert clash_detail["header"]["clash_at_admission"] is True
    assert "Clash at block amount" in (clash_detail["header"]["clash_note"] or "")
    assert clash_detail["header"]["clash_with"]
    assert "Counsellor" in clash_detail["header"]["clash_with"]
    assert "Block" in clash_detail["header"]["clash_with"]
    assert clash_detail["header"]["original_utm_campaign"]
    assert clash_detail["header"]["original_utm_medium"]
    assert clash_detail["header"]["campaign_at_payment"]
    assert (clash_detail["header"].get("lsq_stage_label") or "").startswith("Offer Letter")
    assert clash_detail["header"]["block_payment_done"] is True
    assert clash_detail["header"]["sem_fee_verified"] is True
    block_only = service.list_students(clash="block", page=1, page_size=50)
    assert block_only["total"] == 1
    assert block_only["items"][0]["email"] == "clash@example.com"
    admission_only = service.list_students(clash="admission", page=1, page_size=50)
    assert admission_only["total"] == 2
    unmatched_only = service.list_students(channel="unmatched_lsq", page=1, page_size=50)
    assert unmatched_only["total"] == 1
    campus_step = next(s for s in clash_detail["path"] if s["key"] == "campus")
    assert campus_step["empty"] is False
    assert clash_detail["header"]["amount_inr"] == "10000"
    utm_step = next(s for s in clash_detail["path"] if s["key"] == "original_utm")
    labels = [f["label"] for f in utm_step["fields"]]
    assert "Medium" in labels
    assert "Campaign" in labels
    assert any(chip.get("detail") for chip in clash_detail["stages"])
    assert clash["lsq_created_on"]
    assert clash_detail["header"]["lsq_modified_on"]
    assert clash_detail["header"]["sheet_created_at"]
    event_labels = [item["label"] for item in clash_detail["events"]]
    assert "Lead created" in event_labels
    assert "Last LSQ activity" in event_labels
    assert "Sheet created" in event_labels
    assert "LMS submitted" in event_labels
    parsed_events = [parse_event_datetime(item["at"]) for item in clash_detail["events"]]
    assert all(parsed_events)
    assert parsed_events == sorted(parsed_events)
    assert all(step.get("date") is not None for step in clash_detail["path"])
    assert all("at" in chip for chip in clash_detail["stages"])

    organic_detail = service.get_student(organic["journey_id"])
    organic_labels = [item["label"] for item in organic_detail["events"]]
    assert "Last LSQ activity" not in organic_labels
    assert "Lead created" not in organic_labels
    assert all(parse_event_datetime(item["at"]) for item in organic_detail["events"])


def test_export_students_csv_includes_full_journey_detail(tmp_path):
    import csv
    from io import StringIO

    settings = _settings(tmp_path)
    adm = AdmissionsService(settings=settings)
    adm.upload_sheet(
        "admissions.csv",
        b"ID,Student Name,Email,Phone,University,Semester I Amount Payment Status,"
        b"AmountInr,Paid,PaidAt,"
        b"Block Amount Paid,Block Amount Payment Status,"
        b"Semester Amount UTR No / Transaction ID,Block Amount UTR No / Transaction ID,"
        b"CreatedAt,UpdatedAt\n"
        b"1,Export Lead,export@example.com,9111111111,ADYPU,Full Payment,10000,true,2026-05-10,"
        b"5000,Paid,SEMUTR111,BLOCKUTR222,2026-04-01,2026-05-11\n",
    )
    service = AdmissionJourneyService(settings=settings, lsq_client=FakeLSQ({}))
    service.sync()

    csv_text = service.export_students_csv()
    reader = csv.DictReader(StringIO(csv_text))
    rows = list(reader)
    assert len(rows) == 1
    row = rows[0]
    assert row["email"] == "export@example.com"
    assert row["name"] == "Export Lead"
    assert row["sheet_status"] == "Full Payment"
    assert row["sem_utr"] == "SEMUTR111"
    assert row["block_utr"] == "BLOCKUTR222"
    assert row["block_amount"] == "5000"
    assert row["block_payment_status"] == "Partial Payment"
    assert "step_amounts_fields" in row
    assert "Block payment status" in (row["step_amounts_fields"] or "")
    assert "stage_block_reached" in row
    assert row["stage_block_reached"] in {"True", "true", "1"}
    assert "step_created_lsq" in reader.fieldnames
    assert "events" in reader.fieldnames


def test_sync_does_not_touch_master_parquet(tmp_path):
    settings = _settings(tmp_path)
    _seed_sheets(settings)
    master_path = settings.parquet_dir / MASTER_PARQUET_FILE
    pl.DataFrame({"prospect_id": ["keep-me"], "partner": ["Careers360"]}).write_parquet(
        master_path
    )
    before = master_path.read_bytes()
    mtime = master_path.stat().st_mtime

    service = AdmissionJourneyService(settings=settings, lsq_client=FakeLSQ({}))
    service.sync()

    assert master_path.exists()
    assert master_path.read_bytes() == before
    assert master_path.stat().st_mtime == mtime
    assert (settings.parquet_dir / "admission_journey.parquet").exists()
    listed = service.list_students(page=1, page_size=50)
    assert listed["total"] == 5
    assert all(row["channel"] == CHANNEL_UNMATCHED for row in listed["items"])


def test_router_smoke_paths():
    from app.api.routes import admission_journey
    from app.main import create_app

    router_paths = {getattr(route, "path", "") for route in admission_journey.router.routes}
    assert "/admission-journey/status" in router_paths
    assert "/admission-journey/sync" in router_paths
    assert "/admission-journey/students" in router_paths
    assert "/admission-journey/students/{journey_id}" in router_paths
    assert "/admission-journey/export" in router_paths

    app = create_app()
    app_paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/v1/admission-journey/status" in app_paths
    assert "/api/v1/admission-journey/students/{journey_id}" in app_paths


def test_journey_id_is_stable():
    first = make_journey_id("1", "a@example.com", "9000000001")
    second = make_journey_id("1", "a@example.com", "9000000001")
    other = make_journey_id("2", "a@example.com", "9000000001")
    assert first == second
    assert first != other


def test_build_journey_events_sorts_and_skips_empty():
    events = build_journey_events(
        {
            "lsq_created_on": "2026-05-01 10:00:00",
            "lsq_modified_on": "2026-05-20 14:00:00",
            "sheet_created_at": "2026-04-01",
            "sheet_updated_at": "",
            "lms_submitted_on": None,
            "lms_paid_on": "not-a-date",
            "lms_verified_on": "  ",
            "paid_at": "2026-05-10",
            "dop": "2026-05-10",
        }
    )
    labels = [item["label"] for item in events]
    assert labels == [
        "Sheet created",
        "Lead created",
        "Semester paid",
        "Last LSQ activity",
    ]
    parsed = [parse_event_datetime(item["at"]) for item in events]
    assert parsed == sorted(parsed)
    assert parse_event_datetime("") is None
    assert parse_event_datetime("2026-05-20 14:00:00") is not None
