"""Tests for admissions sheet upload, LMS fee status, and analytics matching."""

import polars as pl

from app.services.admissions_service import (
    AdmissionsService,
    apply_admissions_mapping,
    apply_lms_mapping,
    is_paid_value,
    normalize_admissions_header,
    normalize_lms_header,
)


def test_normalize_admissions_header_aliases():
    assert normalize_admissions_header("Email") == "email"
    assert normalize_admissions_header("Student Email") == "email"
    assert normalize_admissions_header("Student Phone") == "phone"
    assert normalize_admissions_header("University") == "campus_code"
    assert normalize_admissions_header("AmountInr") == "amount_inr"
    assert normalize_admissions_header("CampusCode") == "campus_code"
    assert normalize_admissions_header("Semester I Amount Payment Status") == "status"
    assert normalize_admissions_header("Semester Fee Paid DOP") == "paid_at"


def test_normalize_lms_header_aliases():
    assert normalize_lms_header("Candidate Email") == "email"
    assert normalize_lms_header("Candidate Name") == "candidate_name"
    assert normalize_lms_header("Campus") == "campus"
    assert normalize_lms_header("Status") == "status"
    assert normalize_lms_header("Verified Paid (INR)") == "verified_paid_inr"
    assert normalize_lms_header("Payable (INR)") == "payable_inr"


def test_is_paid_value():
    assert is_paid_value(True) is True
    assert is_paid_value("true") is True
    assert is_paid_value("1") is True
    assert is_paid_value("Paid") is True
    assert is_paid_value("Verified") is True
    assert is_paid_value("Full Payment") is True
    assert is_paid_value("Partial Payment") is True
    assert is_paid_value("false") is False
    assert is_paid_value("0") is False
    assert is_paid_value(None) is False
    assert is_paid_value("") is False


def test_apply_admissions_mapping():
    raw = pl.DataFrame(
        {
            "ID": ["1"],
            "Student Email": ["a@example.com"],
            "Student Phone": ["9000000001"],
            "University": ["ADYPU"],
            "Semester I Amount Payment Status": ["Paid"],
        }
    )
    mapped = apply_admissions_mapping(raw)
    assert mapped["email"][0] == "a@example.com"
    assert mapped["phone"][0] == "9000000001"
    assert mapped["campus_code"][0] == "ADYPU"
    assert mapped["status"][0] == "Paid"
    assert mapped["sheet_id"][0] == "1"


def test_apply_lms_mapping():
    raw = pl.DataFrame(
        {
            "Candidate Name": ["Alice"],
            "Candidate Email": ["a@example.com"],
            "Phone": ["9000000001"],
            "Campus": ["SSAHE"],
            "Semester": ["1"],
            "Status": ["Verified"],
        }
    )
    mapped = apply_lms_mapping(raw)
    assert mapped["email"][0] == "a@example.com"
    assert mapped["campus"][0] == "SSAHE"
    assert mapped["status"][0] == "Verified"


def test_admissions_upload_and_campus_enrichment(tmp_path):
    from app.config import Settings
    from app.domain.models import FilterParams
    from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
    from app.services.analytics_service import AnalyticsEngine
    from app.services.block_payment_service import BlockPaymentService

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
    )
    (tmp_path / "parquet").mkdir(parents=True)

    block_svc = BlockPaymentService(settings=settings)
    adm_svc = AdmissionsService(settings=settings)

    block_svc.upload_sheet(
        "payments.csv",
        b"Email,Phone,CollegeCode,Gender,State\n"
        b"a@example.com,9000000001,ADYPU,Male,Karnataka\n"
        b"b@example.com,9000000002,SSAHE,Female,Maharashtra\n",
    )
    adm_svc.upload_sheet(
        "admissions.csv",
        b"ID,Email,Semester,AmountInr,AmountPaise,CampusCode,CreatedAt,FinalizedBy,"
        b"OrderId,Paid,PaidAt,PaymentId,Status,TransferId,TransferPending,TransferStatus,UpdatedAt\n"
        b"1,a@example.com,1,10000,1000000,ADYPU,2026-01-01,ops,o1,true,2026-01-02,p1,paid,t1,false,done,2026-01-03\n"
        b"2,b@example.com,1,10000,1000000,SSAHE,2026-01-01,ops,o2,true,2026-01-02,p2,paid,t2,false,done,2026-01-03\n"
        b"3,c@example.com,1,10000,1000000,ADYPU,2026-01-01,ops,o3,false,2026-01-02,p3,pending,t3,true,pending,2026-01-03\n",
    )

    status = adm_svc.get_status()
    assert status["has_data"] is True
    assert status["row_count"] == 3
    assert status["paid_count"] == 2

    duck = DuckDBRepository(settings)
    engine = AnalyticsEngine(duck_repo=duck, cache=AnalyticsCache(ttl_seconds=0))
    campus = engine.get_campus_admissions(FilterParams())

    assert campus["has_sheet"] is True
    assert campus["total_paid"] == 2
    assert campus["matched_to_block"] == 2
    assert campus["unmatched_to_block"] == 0
    states = {r["state"] for r in campus["admission_state_summary"]}
    assert "Karnataka" in states
    assert "Maharashtra" in states
    genders = {g["gender"]: g["count"] for g in campus["by_gender"]}
    assert genders.get("Male") == 1
    assert genders.get("Female") == 1
    assert len(campus.get("campus_gender_charts") or []) >= 2


def test_lms_verified_sem1_kpi_and_phone_block_match(tmp_path):
    from app.config import Settings
    from app.domain.models import FilterParams
    from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
    from app.services.analytics_service import AnalyticsEngine
    from app.services.block_payment_service import BlockPaymentService

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
    )
    (tmp_path / "parquet").mkdir(parents=True)

    block_svc = BlockPaymentService(settings=settings)
    adm_svc = AdmissionsService(settings=settings)

    block_svc.upload_sheet(
        "payments.csv",
        b"Email,Phone,CollegeCode,Gender,State\n"
        b"other@example.com,9876543210,ADYPU,Male,Goa\n",
    )
    # All Payments list — phone matches block (email differs)
    adm_svc.upload_sheet(
        "admissions.csv",
        b"Student Name,Student Email,Student Phone,University,Semester I Amount Payment Status,Amount Received\n"
        b"Alice,alice@example.com,9876543210,ADYPU,Paid,10000\n",
    )
    # LMS fee status
    lms_csv = (
        b"S. No.,Candidate Name,Candidate Email,Phone,Campus,Semester,Status,"
        b"Payable (INR),Verified Paid (INR),Pending (INR),Remaining (INR)\n"
        b"1,Alice,alice@example.com,9876543210,ADYPU,1,Verified,100000,100000,0,0\n"
        b"2,Bob,bob@example.com,9000000002,SSAHE,1,Under review,100000,0,100000,100000\n"
        b"3,Carol,carol@example.com,9000000003,SSAHE,1,Partly paid,100000,50000,0,50000\n"
        b"4,Dan,dan@example.com,9000000004,ADYPU,2,Verified,100000,100000,0,0\n"
    )
    raw = adm_svc._read_file("lms.csv", lms_csv)
    frame = adm_svc._normalize_lms_frame(raw, "lms.csv")
    adm_svc._write_lms_frame(frame, "lms.csv")

    duck = DuckDBRepository(settings)
    engine = AnalyticsEngine(duck_repo=duck, cache=AnalyticsCache(ttl_seconds=0))
    campus = engine.get_campus_admissions(FilterParams())

    fee = campus["fee_status"]
    assert fee["has_lms"] is True
    assert fee["verified"] == 1  # Sem1 Verified only (Dan is Sem2)
    assert fee["under_review"] == 1
    assert fee["partly_paid"] == 1
    assert campus["verified_sem1"] == 1
    assert campus["matched_to_block"] == 1  # phone match
    assert campus["rows"][0]["gender"] == "Male"
    assert campus["rows"][0]["state"] == "Goa"


def test_sync_from_public_csv(tmp_path, httpx_mock=None):
    from unittest.mock import MagicMock, patch

    from app.config import Settings

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
        google_admissions_payments_public_csv_url="https://example.com/payments.csv",
        google_admissions_lms_public_csv_url="https://example.com/lms.csv",
    )
    (tmp_path / "parquet").mkdir(parents=True)
    service = AdmissionsService(settings=settings)

    payments_body = (
        b"Student Email,Student Phone,University,Semester I Amount Payment Status\n"
        b"a@example.com,9000000001,ADYPU,Paid\n"
    )
    lms_body = (
        b"Candidate Email,Phone,Campus,Semester,Status\n"
        b"a@example.com,9000000001,ADYPU,1,Verified\n"
    )

    class FakeResp:
        def __init__(self, content: bytes):
            self.content = content

        def raise_for_status(self):
            return None

    with patch("httpx.get") as mock_get:
        mock_get.side_effect = [
            FakeResp(payments_body),
            FakeResp(lms_body),
        ]
        result = service.sync_from_public_csv()

    assert result["status"] == "completed"
    assert result["row_count"] == 1
    assert result["lms_row_count"] == 1
    assert result["verified_count"] == 1
    status = service.get_status()
    assert status["has_payments"] is True
    assert status["has_lms"] is True


def test_recompute_admission_from_sheets_marks_dp_lead(tmp_path):
    from app.config import Settings
    from app.domain.models import FilterParams
    from app.domain.schema import ALL_COLUMNS, BOOLEAN_COLUMNS, MASTER_PARQUET_FILE
    from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
    from app.services.analytics_service import AnalyticsEngine

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
    )
    parquet_dir = tmp_path / "parquet"
    parquet_dir.mkdir(parents=True)

    master_row = {c: None for c in ALL_COLUMNS}
    for c in BOOLEAN_COLUMNS:
        master_row[c] = False
    master_row.update(
        {
            "prospect_id": "p1",
            "email": "admit@example.com",
            "phone": "919876543210",
            "partner": "College Dunia",
            "name": "Admit Me",
            "funnel_stage": "Offer Letter",
            "offer_letter": True,
            "admission": False,
        }
    )
    pl.DataFrame([master_row]).select(ALL_COLUMNS).write_parquet(
        parquet_dir / MASTER_PARQUET_FILE
    )

    AdmissionsService(settings=settings).upload_sheet(
        "admissions.csv",
        b"Student Email,Student Phone,University,Semester I Amount Payment Status\n"
        b"admit@example.com,9876543210,ADYPU,Full Payment\n",
    )

    duck = DuckDBRepository(settings)
    engine = AnalyticsEngine(duck_repo=duck, cache=AnalyticsCache(ttl_seconds=0))
    dp = engine.get_dp_admissions(FilterParams())
    assert dp["dp_matched"] >= 1

    flagged = duck.query_dicts(
        "SELECT COUNT(*) AS c FROM master_dataset WHERE admission AND email = 'admit@example.com'"
    )
    assert int(flagged[0]["c"]) >= 1
