"""Tests for LeadSquared field mapping and sync helpers."""

from datetime import datetime

import polars as pl

from app.services.leadsquared_client import DEFAULT_PAGE_SIZE, _clamp_page_size
from app.services.leadsquared_mapper import (
    lead_include_csv,
    map_activities_to_dataframe,
    map_leads_to_dataframe,
)
from app.services.leadsquared_sync_service import LeadSquaredSyncService


def test_lead_include_csv_has_prospect_id():
    csv = lead_include_csv()
    assert "ProspectID" in csv


def test_map_leads_to_dataframe_canonical_columns():
    leads = [
        {
            "ProspectID": "abc-123",
            "FirstName": "Ada",
            "LastName": "Lovelace",
            "EmailAddress": "ada@example.com",
            "Source": "Careers360",
            "CreatedOn": "2025-01-15 10:00:00",
            "mx_Main_Lead_Stages": "MQL",
            "mx_Contact_Stage": "Connected",
        }
    ]
    df = map_leads_to_dataframe(leads)
    assert df.height == 1
    assert df.get_column("prospect_id")[0] == "abc-123"
    assert df.get_column("email")[0] == "ada@example.com"
    assert df.get_column("source")[0] == "Careers360"
    assert "name" in df.columns
    assert df.get_column("lead_stage")[0] == "MQL"
    assert df.get_column("contact_stage")[0] == "Connected"


def test_map_leads_prospect_stage_is_crm_contact_stage():
    """CRM Contact Stage = ProspectStage; Main Lead Stages stay on lead_stage."""
    leads = [
        {
            "ProspectID": "aarohan-1",
            "FirstName": "Aarohan",
            "LastName": "prasad",
            "Source": "College Hai",
            "CreatedOn": "2026-01-15 10:00:00",
            "ProspectStage": "Block Amount Paid",
            "mx_Main_Lead_Stages": "Offer Letter Released",
            "mx_Contact_Stage": None,
        }
    ]
    df = map_leads_to_dataframe(leads)
    assert df.get_column("contact_stage")[0] == "Block Amount Paid"
    assert df.get_column("lead_stage")[0] == "Offer Letter Released"


def test_map_leads_mixed_types_do_not_crash():
    """Numeric-looking early rows must not break when a later value is a name."""
    leads = [
        {
            "ProspectID": "1",
            "FirstName": "Ada",
            "LastName": "Lovelace",
            "EmailAddress": "ada@example.com",
            "Source": "Careers360",
            "CreatedOn": "2025-01-15 10:00:00",
            "mx_City": 110001,
        },
        {
            "ProspectID": "2",
            "FirstName": "MOYLI",
            "LastName": "P R",
            "EmailAddress": "moyli@example.com",
            "Source": "College Hai",
            "CreatedOn": "2025-01-16 10:00:00",
            "mx_City": "MOYLI P R",
        },
    ]
    df = map_leads_to_dataframe(leads)
    assert df.height == 2
    assert "MOYLI" in str(df.get_column("name")[1])


def test_map_activities_to_dataframe():
    activities = [
        {
            "ProspectId": "abc-123",
            "EmailAddress": "ada@example.com",
            "CreatedOn": "2025-01-15 11:00:00",
            "Id": "act-1",
            "EventName": "Know More about B.Tech",
        }
    ]
    df = map_activities_to_dataframe(activities)
    assert isinstance(df, pl.DataFrame)
    assert df.height == 1
    assert df.get_column("prospect_id")[0] == "abc-123"
    assert "notes" in df.columns


def test_is_know_more_about_btech_event():
    from app.services.persona_activity_service import is_know_more_about_btech_event

    assert is_know_more_about_btech_event("Know More about B.Tech") is True
    assert is_know_more_about_btech_event("Know More about B. Tech") is True
    assert is_know_more_about_btech_event("Lead Capture") is False
    assert is_know_more_about_btech_event(None) is False


def test_page_size_clamped():
    assert _clamp_page_size(1000) == 1000
    assert _clamp_page_size(99999) == 5000
    assert _clamp_page_size(0) == 1
    assert DEFAULT_PAGE_SIZE == 1000


def test_date_windows_chunking():
    windows = LeadSquaredSyncService._date_windows(
        datetime(2026, 1, 1), datetime(2026, 1, 20), 7
    )
    assert len(windows) == 3
    assert windows[0][0] == datetime(2026, 1, 1)
    assert windows[-1][1] == datetime(2026, 1, 20)
