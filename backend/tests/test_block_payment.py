"""Tests for block payment UTM Source/Campaign at Payment derivation."""

from app.config import Settings
from app.services.block_payment_service import (
    BlockPaymentService,
    extract_utm_campaign_at_payment,
    extract_utm_source_at_payment,
    fill_payment_utm_from_activity,
)


# Mirrors Sheets REGEXEXTRACT after application-fee"].*?utm_source / utm_campaign
SAMPLE_UTM_ACTIVITY = (
    '[{"event":"signup","utm_source":"careers360"},'
    '{"event":"application-fee"],"foo":1,'
    'utm_source "collegehai", utm_campaign "summer_block_2026"}]'
)


def test_extract_utm_source_at_payment():
    assert extract_utm_source_at_payment(SAMPLE_UTM_ACTIVITY) == "collegehai"


def test_extract_utm_campaign_at_payment():
    assert extract_utm_campaign_at_payment(SAMPLE_UTM_ACTIVITY) == "summer_block_2026"


def test_extract_returns_none_when_missing():
    assert extract_utm_source_at_payment("no application fee here") is None
    assert extract_utm_campaign_at_payment("") is None
    assert extract_utm_source_at_payment(None) is None


def test_fill_keeps_existing_values():
    source, campaign = fill_payment_utm_from_activity(
        "manual_source",
        "manual_campaign",
        SAMPLE_UTM_ACTIVITY,
    )
    assert source == "manual_source"
    assert campaign == "manual_campaign"


def test_fill_replaces_not_found_and_blanks():
    source, campaign = fill_payment_utm_from_activity(
        "Not Found",
        "",
        SAMPLE_UTM_ACTIVITY,
    )
    assert source == "collegehai"
    assert campaign == "summer_block_2026"


def test_normalize_frame_derives_payment_utm(tmp_path, monkeypatch):
    import polars as pl
    from app.config import Settings

    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
    )
    (tmp_path / "parquet").mkdir(parents=True)

    service = BlockPaymentService(settings=settings)
    raw = pl.DataFrame(
        {
            "Email": ["a@example.com"],
            "Phone": ["9999999999"],
            "Utm Activity": [SAMPLE_UTM_ACTIVITY],
            "Source at Payment": ["Not Found"],
            "Campaign at Payment": [None],
        }
    )
    frame = service._normalize_frame(raw, "metabase.csv")
    assert frame["source_at_payment"][0] == "collegehai"
    assert frame["campaign_at_payment"][0] == "summer_block_2026"


def test_campus_fill_patches_blank_only(tmp_path):
    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
    )
    (tmp_path / "parquet").mkdir(parents=True)
    service = BlockPaymentService(settings=settings)

    service.upload_sheet(
        "block.csv",
        b"Email,Phone,Gender,State,SeatBlocking: CollegeCode,SeatBlocking: CollegeName,Source at Payment\n"
        b"a@example.com,9876543210,Male,Karnataka,ADYPU,ADYPU Campus,Partner\n"
        b"b@example.com,9876543211,Female,Maharashtra,,,\n"
        b"c@example.com,9876543212,Male,Delhi,,,\n",
    )

    blank = service.list_blank_campus_rows()
    assert blank["total"] == 2

    result = service.apply_campus_fill_sheet(
        "campus_fill.csv",
        b"ID,StudentEmail,StudentName,StudentPhone,CreatedAt,CollegeName,CollegeCode,Status\n"
        b"1,b@example.com,Bob,9876543211,2026-01-01,SSAHE Campus,SSAHE,Active\n"
        b"2,nobody@example.com,Nobody,1111111111,2026-01-01,ADYPU Campus,ADYPU,Active\n",
    )
    assert result["updated"] == 1
    assert result["unmatched"] == 1
    assert result["still_blank"] == 1

    blank_after = service.list_blank_campus_rows()
    assert blank_after["total"] == 1
    assert blank_after["items"][0]["email"] == "c@example.com"

    import polars as pl

    frame = pl.read_parquet(service.parquet_path)
    by_email = {r["email"]: r for r in frame.iter_rows(named=True)}
    assert by_email["a@example.com"]["college_code"] == "ADYPU"
    assert by_email["a@example.com"]["gender"] == "Male"
    assert by_email["a@example.com"]["state"] == "Karnataka"
    assert by_email["a@example.com"]["source_at_payment"] == "Partner"
    assert by_email["b@example.com"]["college_code"] == "SSAHE"
    assert by_email["b@example.com"]["gender"] == "Female"
    assert by_email["b@example.com"]["state"] == "Maharashtra"
    assert not (by_email["c@example.com"]["college_code"] or "").strip()


def test_reject_campus_fill_uploaded_as_main_sheet(tmp_path):
    settings = Settings(
        data_dir=str(tmp_path),
        parquet_dir=str(tmp_path / "parquet"),
        duckdb_path=str(tmp_path / "analytics.duckdb"),
        metadata_db_url=f"sqlite:///{tmp_path / 'metadata.db'}",
    )
    (tmp_path / "parquet").mkdir(parents=True)
    service = BlockPaymentService(settings=settings)

    try:
        service.upload_sheet(
            "campus_only.csv",
            b"ID,StudentEmail,StudentName,StudentPhone,CreatedAt,CollegeName,CollegeCode,Status\n"
            b"1,a@example.com,A,9876543210,2026-01-01,ADYPU Campus,ADYPU,Active\n",
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "campus fill" in str(exc).lower()
