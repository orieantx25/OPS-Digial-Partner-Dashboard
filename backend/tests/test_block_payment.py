"""Tests for block payment UTM Source/Campaign at Payment derivation."""

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
