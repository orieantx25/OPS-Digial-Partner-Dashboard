"""Tests for refund tracking sheet mapping and is_refund derivation."""

import polars as pl

from app.services.refund_service import (
    apply_refund_mapping,
    is_refund_final_status,
    normalize_refund_header,
    RefundService,
)


def test_normalize_refund_header_aliases():
    assert normalize_refund_header("Final Status") == "final_status"
    assert normalize_refund_header("Mail ID") == "email"
    assert normalize_refund_header("S No.") == "serial_no"


def test_is_refund_final_status():
    assert is_refund_final_status("Refunded") is True
    assert is_refund_final_status("Refund processed") is True
    assert is_refund_final_status("Pending") is False
    assert is_refund_final_status("") is False
    assert is_refund_final_status(None) is False


def test_apply_refund_mapping_coalesces_duplicate_headers():
    raw = pl.DataFrame(
        {
            "Mail ID": ["a@example.com"],
            "Remarks": ["note"],
            "remarks": ["dup"],
        }
    )
    mapped = apply_refund_mapping(raw)
    assert "email" in mapped.columns
    assert mapped["email"][0] == "a@example.com"


def test_normalize_frame_sets_is_refund(tmp_path):
    from app.config import Settings

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
    )
    (tmp_path / "parquet").mkdir(parents=True)

    service = RefundService(settings=settings)
    raw = pl.DataFrame(
        {
            "Student Name": ["Alice"],
            "Mail ID": ["alice@example.com"],
            "Phone Number": ["9876543210"],
            "Final Status": ["Refunded"],
            "Campus": ["ADYPU"],
        }
    )
    frame = service._normalize_frame(raw, "refunds.xlsx")
    assert frame["is_refund"][0] is True
    assert frame["match_email"][0] == "alice@example.com"
    assert frame["match_phone"][0] == "9876543210"


def test_sync_from_public_csv(tmp_path, monkeypatch):
    from app.config import Settings

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
        google_refund_public_csv_url="https://example.com/refund.csv",
    )
    (tmp_path / "parquet").mkdir(parents=True)

    csv_body = (
        "Mail ID,Phone Number,Final Status\n"
        "bob@example.com,9876543210,Refunded\n"
    ).encode()

    class FakeResponse:
        content = csv_body

        def raise_for_status(self):
            return None

    def fake_get(url, follow_redirects=True, timeout=120.0):
        assert url == "https://example.com/refund.csv"
        return FakeResponse()

    monkeypatch.setattr("httpx.get", fake_get)

    service = RefundService(settings=settings)
    result = service.sync_from_public_csv()
    assert result["status"] == "completed"
    assert result["row_count"] == 1
    assert service.get_status()["has_data"] is True


def test_refund_exclude_sql_reduces_matched_payment_rows(tmp_path):
    from app.config import Settings
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
    refund_svc = RefundService(settings=settings)

    block_svc.upload_sheet(
        "payments.csv",
        b"Email,Phone,CollegeCode,Gender\n"
        b"a@example.com,9876543210,ADYPU,Male\n"
        b"b@example.com,9876543211,SSAHE,Female\n",
    )
    refund_svc.upload_sheet(
        "refunds.csv",
        b"Mail ID,Phone Number,Final Status\n"
        b"a@example.com,9876543210,Refunded\n",
    )

    duck = DuckDBRepository(settings)
    engine = AnalyticsEngine(duck_repo=duck, cache=AnalyticsCache(ttl_seconds=0))
    exclude = engine._refund_exclude_sql("s")

    total_rows = duck.query_dicts("SELECT COUNT(*) AS cnt FROM block_payment_tracking")
    adjusted_rows = duck.query_dicts(
        f"SELECT COUNT(*) AS cnt FROM block_payment_tracking s WHERE 1=1 {exclude}"
    )
    assert int(total_rows[0]["cnt"]) == 2
    assert int(adjusted_rows[0]["cnt"]) == 1


def test_roi_excludes_dp_refunds(tmp_path):
    import io

    import polars as pl
    from app.config import Settings
    from app.domain.models import FilterParams
    from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
    from app.services.analytics_service import AnalyticsEngine
    from app.services.block_payment_service import BlockPaymentService
    from app.services.ingestion_service import IngestionEngine

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
    )
    (tmp_path / "parquet").mkdir(parents=True)

    partner = "Careers360"
    df = pl.DataFrame(
        {
            "Prospect ID": ["p1", "p2"],
            "Email": ["a@example.com", "b@example.com"],
            "Phone": ["9876543210", "9876543211"],
            "Contact Source": [partner, partner],
            "Contact Stage": ["Block Amount Paid", "Block Amount Paid"],
            "Date": ["2025-01-01", "2025-01-02"],
        }
    )
    buf = io.BytesIO()
    df.write_csv(buf)
    ingest = IngestionEngine(settings=settings, duck_repo=DuckDBRepository(settings))
    report = ingest.process_upload_batch([("master.csv", buf.getvalue())])
    assert report.total_rows_accepted == 2

    block_svc = BlockPaymentService(settings=settings)
    refund_svc = RefundService(settings=settings)
    block_svc.upload_sheet(
        "payments.csv",
        b"Email,Phone,CollegeCode,Gender\n"
        b"a@example.com,9876543210,ADYPU,Male\n"
        b"b@example.com,9876543211,SSAHE,Female\n",
    )
    refund_svc.upload_sheet(
        "refunds.csv",
        b"Mail ID,Phone Number,Final Status\n"
        b"a@example.com,9876543210,Refunded\n",
    )

    duck = DuckDBRepository(settings)
    engine = AnalyticsEngine(duck_repo=duck, cache=AnalyticsCache(ttl_seconds=0))
    revenue = engine.get_revenue_dashboard(FilterParams())
    partner_row = next(p for p in revenue["partners"] if p["partner"] == partner)
    assert partner_row["block_amount_paid"] == 2
    assert partner_row["dp_refunds"] == 1
    assert partner_row["block_amount_roi"] == 1
