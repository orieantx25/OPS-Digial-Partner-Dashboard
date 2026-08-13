"""Tests for refund tracking sheet mapping and is_refund derivation."""

import polars as pl

from app.services.refund_service import (
    apply_refund_mapping,
    is_on_hold_sst_status,
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
    assert is_refund_final_status("On hold as per SST team") is False
    assert is_refund_final_status("Refund on hold as per SST team") is False
    assert is_on_hold_sst_status("On hold as per SST team") is True
    assert is_on_hold_sst_status("Refunded") is False


def test_on_hold_sst_not_counted_as_refund_applied(tmp_path):
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
        b"Mail ID,Phone Number,Final Status,Campus\n"
        b"a@example.com,9876543210,Refunded,ADYPU\n"
        b"b@example.com,9876543211,On hold as per SST team,SSAHE\n"
        b"c@example.com,9876543212,Sent to Uni,ADYPU\n"
        b"d@example.com,9876543213,Processed,SSAHE\n",
    )

    duck = DuckDBRepository(settings)
    engine = AnalyticsEngine(duck_repo=duck, cache=AnalyticsCache(ttl_seconds=0))
    summary = engine._refund_summary()

    assert summary["total_cases"] == 4  # all students on the sheet
    assert summary["retained_cases"] == 1  # On hold as per SST team
    assert summary["refunded_cases"] == 1  # Refunded
    assert summary["refund_cases"] == 1
    assert summary["refund_processed"] == 2  # Sent to Uni + Processed
    assert summary["refunds_applied_by_campus"]["ADYPU"] == 2
    assert summary["refunds_applied_by_campus"]["SSAHE"] == 2
    assert summary["retained_by_campus"]["SSAHE"] == 1
    assert summary["retained_by_campus"]["ADYPU"] == 0
    assert summary["refunded_by_campus"]["ADYPU"] == 1
    assert summary["refunded_by_campus"]["SSAHE"] == 0
    assert summary["by_campus"]["ADYPU"] == 1  # Sent to Uni
    assert summary["by_campus"]["SSAHE"] == 1  # Processed

    chart = engine._overall_refund_by_campus_chart()
    assert chart is not None
    chart_by_label = dict(zip(chart.categories, chart.series[0].data))
    assert chart.series[0].name == "Refund cases"
    assert chart.series[1].name == "Retained"
    assert chart.series[2].name == "Refunded"
    assert chart_by_label.get("SSAHE, Tumkur") == summary["refunds_applied_by_campus"]["SSAHE"]
    assert chart_by_label.get("ADYPU, Pune") == summary["refunds_applied_by_campus"]["ADYPU"]
    retained_by_label = dict(zip(chart.categories, chart.series[1].data))
    assert retained_by_label.get("SSAHE, Tumkur") == summary["retained_by_campus"]["SSAHE"]
    assert retained_by_label.get("ADYPU, Pune") == summary["retained_by_campus"]["ADYPU"]
    refunded_by_label = dict(zip(chart.categories, chart.series[2].data))
    assert refunded_by_label.get("SSAHE, Tumkur") == summary["refunded_by_campus"]["SSAHE"]
    assert refunded_by_label.get("ADYPU, Pune") == summary["refunded_by_campus"]["ADYPU"]
    assert sum(chart.series[0].data) == summary["total_cases"]

    # On-hold must not remove the student from active block
    exclude = engine._refund_exclude_sql("s")
    adjusted_rows = duck.query_dicts(
        f"SELECT COUNT(*) AS cnt FROM block_payment_tracking s WHERE 1=1 {exclude}"
    )
    assert int(adjusted_rows[0]["cnt"]) == 1  # only a@example.com removed


def test_active_block_excludes_applied_keeps_retained(tmp_path):
    """Active block = all blocks − applied refunds; retained (on-hold SST) stay in."""
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
        b"Email,Phone,CollegeCode,Gender,State\n"
        b"applied@example.com,9000000001,ADYPU,Male,Karnataka\n"
        b"retained@example.com,9000000002,SSAHE,Female,Maharashtra\n"
        b"clean@example.com,9000000003,ADYPU,Male,Goa\n",
    )
    refund_svc.upload_sheet(
        "refunds.csv",
        b"Mail ID,Phone Number,Final Status,Campus\n"
        b"applied@example.com,9000000001,Refunded,ADYPU\n"
        b"retained@example.com,9000000002,On hold as per SST team,SSAHE\n",
    )

    duck = DuckDBRepository(settings)
    engine = AnalyticsEngine(duck_repo=duck, cache=AnalyticsCache(ttl_seconds=0))
    exclude = engine._refund_exclude_sql("s")

    gross = duck.query_dicts("SELECT COUNT(*) AS cnt FROM block_payment_tracking")
    assert int(gross[0]["cnt"]) == 3

    active = duck.query_dicts(
        f"SELECT COUNT(*) AS cnt FROM block_payment_tracking s WHERE 1=1 {exclude}"
    )
    assert int(active[0]["cnt"]) == 2  # applied removed; retained + clean remain

    remaining = {
        r["email"]
        for r in duck.query_dicts(
            f"SELECT email FROM block_payment_tracking s WHERE 1=1 {exclude}"
        )
    }
    assert "applied@example.com" not in remaining
    assert "retained@example.com" in remaining
    assert "clean@example.com" in remaining


def test_refund_campus_prefers_campus_over_university(tmp_path):
    """Campus column wins when university points at the other school (no double-count)."""
    from app.config import Settings
    from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
    from app.services.analytics_service import AnalyticsEngine

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
    )
    (tmp_path / "parquet").mkdir(parents=True)
    refund_svc = RefundService(settings=settings)
    refund_svc.upload_sheet(
        "refunds.csv",
        b"Mail ID,Phone Number,Final Status,Campus,University\n"
        b"a@example.com,9876543210,Refunded,Tumkur,ADYPU\n"
        b"b@example.com,9876543211,Sent to Uni,Pune,SSAHE\n"
        b"c@example.com,9876543212,Pending,Tumkur,SSAHE\n",
    )
    duck = DuckDBRepository(settings)
    engine = AnalyticsEngine(duck_repo=duck, cache=AnalyticsCache(ttl_seconds=0))
    summary = engine._refund_summary()

    assert summary["total_cases"] == 3
    assert summary["refunds_applied_by_campus"]["SSAHE"] == 2  # Tumkur rows
    assert summary["refunds_applied_by_campus"]["ADYPU"] == 1  # Pune row
    assert (
        summary["refunds_applied_by_campus"]["SSAHE"]
        + summary["refunds_applied_by_campus"]["ADYPU"]
        == summary["total_cases"]
    )
    assert summary["refunded_by_campus"]["SSAHE"] == 1
    assert summary["refunded_by_campus"]["ADYPU"] == 0
    assert summary["by_campus"]["ADYPU"] == 1

    chart = engine._overall_refund_by_campus_chart()
    assert chart is not None
    assert len(chart.series) == 3
    assert sum(chart.series[0].data) == 3
    assert sum(chart.series[1].data) == 0  # no on-hold rows in this fixture
    assert sum(chart.series[2].data) == 1
    assert chart.series[1].name == "Retained"
    assert chart.series[2].name == "Refunded"

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


def test_sent_to_uni_on_refund_sheet_reduces_active_block(tmp_path):
    """Sent to Uni / Processed refund rows must reduce active block (not only is_refund)."""
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
        b"a@example.com,9876543210,Sent to Uni\n",
    )

    duck = DuckDBRepository(settings)
    engine = AnalyticsEngine(duck_repo=duck, cache=AnalyticsCache(ttl_seconds=0))
    exclude = engine._refund_exclude_sql("s")
    adjusted_rows = duck.query_dicts(
        f"SELECT COUNT(*) AS cnt FROM block_payment_tracking s WHERE 1=1 {exclude}"
    )
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
