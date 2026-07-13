"""Canonical column definitions for MASTER_DATASET."""

import re
from typing import Dict, List, Optional, Set

# Column name normalization map: various Excel headers -> canonical snake_case
COLUMN_ALIASES: Dict[str, str] = {
    "prospect id": "prospect_id",
    "prospect_id": "prospect_id",
    "prospectid": "prospect_id",
    "id": "prospect_id",
    "name": "name",
    "full name": "name",
    "lead name": "name",
    "email": "email",
    "email id": "email",
    "phone": "phone",
    "phone number": "phone",
    "mobile": "phone",
    "contact stage": "contact_stage",
    "contact_stage": "contact_stage",
    "main lead stages": "lead_stage",
    "main lead stage": "lead_stage",
    "lead stage": "lead_stage",
    "lead_stage": "lead_stage",
    "partner (auto)": "partner",
    "partner": "partner",
    "partner auto": "partner",
    "state": "state",
    "city": "city",
    "date": "date",
    "lead date": "date",
    "created date": "date",
    "prospect creation date": "date",
    "prospect creation date (auto)": "date",
    "date (auto)": "date",
    "created on": "date",
    "last activity date": "last_activity_date",
    "last activity": "last_activity",
    "contact source": "source",
    "mobile number": "phone",
    "connected (auto)": "connected",
    "month (auto)": "month",
    "week start (auto)": "week",
    "week start": "week",
    "source medium": "medium",
    "data source backup": "source",
    "data source batch": "data_source_batch",
    "month": "month",
    "total dialed count": "total_dialed_count",
    "total interacted count": "total_dialed_count",
    "total dialed": "total_dialed_count",
    "total_dialed_count": "total_dialed_count",
    "dials": "total_dialed_count",
    "connected": "connected",
    "mql": "mql",
    "sql": "sql",
    "application": "application",
    "applications": "application",
    "test registration": "test_registration",
    "test registered": "test_registration",
    "test_registration": "test_registration",
    "offer letter": "offer_letter",
    "offer_letter": "offer_letter",
    "interview": "interview",
    "interview stage": "interview",
    "block amount paid": "block_amount_paid",
    "block amount": "block_amount_paid",
    "blocking amount paid": "block_amount_paid",
    "blocking amount": "block_amount_paid",
    "block_amount_paid": "block_amount_paid",
    "token amount paid": "block_amount_paid",
    "token amount": "block_amount_paid",
    "admission": "admission",
    "admissions": "admission",
    "persona": "persona",
    "source": "source",
    "medium": "medium",
    "campaign": "campaign",
    "device": "device",
    "ai status": "ai_status",
    "ai_status": "ai_status",
    "ai qualified": "ai_qualified",
    "ai_qualified": "ai_qualified",
    "ai warm": "ai_warm",
    "ai_warm": "ai_warm",
    "high intent": "ai_high_intent",
    "ai high intent": "ai_high_intent",
    "payment link": "ai_payment_link",
    "brochure": "ai_brochure",
    "dnp": "dnp",
    "interested": "ai_interested",
    "callback": "ai_callback",
    "revenue": "revenue",
    "partner cost": "partner_cost",
    "partner_cost": "partner_cost",
    "fee paid": "fee_paid",
    "know more": "persona_know_more",
    "application started": "persona_application_started",
}

# Keyword-based fallback used when an exact alias match fails.
# Each rule: (canonical_name, [substrings that must ALL appear in the header]).
# Rules are evaluated top-to-bottom; the FIRST match wins, so order matters.
# Date rules come before id/stage rules so "Prospect Creation Date" -> date
# rather than being caught by the "prospect"+"id" style rules.
FUZZY_COLUMN_RULES: List[tuple] = [
    ("last_activity_date", ["last", "activity", "date"]),
    ("last_activity", ["last", "activity"]),
    ("data_source_batch", ["data", "source", "batch"]),
    ("date", ["creation", "date"]),
    ("date", ["created", "date"]),
    ("date", ["lead", "date"]),
    ("date", ["prospect", "date"]),
    ("date", ["date"]),
    ("prospect_id", ["prospect", "id"]),
    ("prospect_id", ["lead", "id"]),
    ("email", ["email"]),
    ("phone", ["mobile"]),
    ("phone", ["phone"]),
    ("contact_stage", ["contact", "stage"]),
    ("lead_stage", ["lead", "stage"]),
    ("partner", ["partner"]),
    ("state", ["state"]),
    ("city", ["city"]),
    ("source", ["source"]),
    ("medium", ["medium"]),
    ("campaign", ["campaign"]),
    ("persona", ["persona"]),
    ("name", ["name"]),
]

# Only truly essential columns are required. Everything else is optional and
# backfilled with nulls, so a single renamed/absent column never rejects a file.
REQUIRED_COLUMNS: List[str] = [
    "prospect_id",
    "date",
]

OPTIONAL_COLUMNS: List[str] = [
    "name",
    "email",
    "contact_stage",
    "lead_stage",
    "partner",
    "state",
    "phone",
    "city",
    "month",
    "total_dialed_count",
    "connected",
    "mql",
    "sql",
    "application",
    "test_registration",
    "interview",
    "offer_letter",
    "block_amount_paid",
    "admission",
    "persona",
    "source",
    "medium",
    "campaign",
    "device",
    "ai_status",
    "ai_qualified",
    "ai_warm",
    "ai_high_intent",
    "ai_payment_link",
    "ai_brochure",
    "dnp",
    "ai_interested",
    "ai_callback",
    "revenue",
    "partner_cost",
    "fee_paid",
    "persona_know_more",
    "persona_application_started",
    "last_activity_date",
    "last_activity",
    "data_source_batch",
]

DERIVED_COLUMNS: List[str] = [
    "contactability",
    "dial_bucket",
    "week",
    "quarter",
    "year",
    "lead_age_days",
    "partner_share",
    "conversion_pct",
    "ai_contacted",
    "funnel_stage",
    "roi",
    "ingested_at",
    "source_file",
    "source_batch_id",
]

ALL_COLUMNS: List[str] = REQUIRED_COLUMNS + OPTIONAL_COLUMNS + DERIVED_COLUMNS

MASTER_DATASET_TABLE = "master_dataset"
MASTER_PARQUET_FILE = "master_dataset.parquet"

# Block payment back-tracking sheet (uploaded separately from MASTER_DATASET).
BLOCK_PAYMENT_TABLE = "block_payment_tracking"
BLOCK_PAYMENT_PARQUET_FILE = "block_payment_tracking.parquet"
BLOCK_PAYMENT_META_FILE = "block_payment_meta.json"

# Persona activity report (last 24h) — uploaded on Persona tab, matched to master.
PERSONA_ACTIVITY_TABLE = "persona_activity_24h"
PERSONA_ACTIVITY_PARQUET_FILE = "persona_activity_24h.parquet"
PERSONA_ACTIVITY_META_FILE = "persona_activity_24h_meta.json"

PERSONA_ACTIVITY_COLUMN_ALIASES: Dict[str, str] = {
    "prospect id": "prospect_id",
    "prospect_id": "prospect_id",
    "prospectid": "prospect_id",
    "email address": "email",
    "email": "email",
    "email id": "email",
    "phone number": "phone",
    "phone": "phone",
    "mobile number": "phone",
    "contact name": "contact_name",
    "name": "contact_name",
    "activity id": "activity_id",
    "activity_id": "activity_id",
    "activity date": "activity_date",
    "activity_date": "activity_date",
    "activity modified on": "activity_modified_on",
    "activity_modified_on": "activity_modified_on",
    "notes": "notes",
}

PERSONA_ACTIVITY_COLUMNS: List[str] = [
    "prospect_id",
    "email",
    "phone",
    "contact_name",
    "activity_id",
    "activity_date",
    "activity_modified_on",
    "notes",
    "match_email",
    "uploaded_at",
    "source_filename",
]

BLOCK_PAYMENT_COLUMN_ALIASES: Dict[str, str] = {
    "id": "sheet_id",
    "email": "email",
    "fullname": "full_name",
    "full name": "full_name",
    "phone": "phone",
    "state": "state",
    "city": "city",
    "original utm: utm medium": "original_utm_medium",
    "original utm: utm campaign": "original_utm_campaign",
    "recent utm": "recent_utm",
    "incompletesections": "incomplete_sections",
    "incomplete sections": "incomplete_sections",
    "utm activity": "utm_activity",
    "source at payment": "source_at_payment",
    "campaign at payment": "campaign_at_payment",
    "contactsource": "contact_source_sheet",
    "contact source": "contact_source_sheet",
    "couponcodeused": "coupon_code_used",
    "coupon code used": "coupon_code_used",
    "gender": "gender",
    "seatblocking: collegecode": "college_code",
    "seatblocking: collegename": "college_name",
}

BLOCK_PAYMENT_COLUMNS: List[str] = [
    "sheet_id",
    "email",
    "full_name",
    "phone",
    "state",
    "city",
    "original_utm_medium",
    "original_utm_campaign",
    "recent_utm",
    "incomplete_sections",
    "utm_activity",
    "source_at_payment",
    "campaign_at_payment",
    "contact_source_sheet",
    "coupon_code_used",
    "gender",
    "college_code",
    "college_name",
    "match_email",
    "match_phone",
    "uploaded_at",
    "source_filename",
]

BOOLEAN_COLUMNS: Set[str] = {
    "connected",
    "mql",
    "sql",
    "application",
    "test_registration",
    "interview",
    "offer_letter",
    "block_amount_paid",
    "admission",
    "ai_qualified",
    "ai_warm",
    "ai_high_intent",
    "ai_payment_link",
    "ai_brochure",
    "dnp",
    "ai_interested",
    "ai_callback",
    "fee_paid",
    "persona_know_more",
    "persona_application_started",
    "ai_contacted",
}

NUMERIC_COLUMNS: Set[str] = {
    "total_dialed_count",
    "revenue",
    "partner_cost",
    "lead_age_days",
    "partner_share",
    "conversion_pct",
    "roi",
}

DATE_COLUMNS: Set[str] = {"date", "last_activity_date"}

# When several workbook columns map to `date`, coalesce in this order (lower = wins).
DATE_HEADER_PRIORITY: Dict[str, int] = {
    "date (auto)": 1,
    "date": 2,
    "prospect creation date (auto)": 3,
    "prospect creation date": 4,
    "created on": 5,
    "lead date": 6,
    "created date": 7,
}


def date_header_priority(header: str) -> int:
    """Priority for coalescing multiple date-like columns (lower = preferred)."""
    cleaned = re.sub(r"\s+", " ", str(header).strip().lower())
    if cleaned in DATE_HEADER_PRIORITY:
        return DATE_HEADER_PRIORITY[cleaned]
    without_auto = re.sub(r"\s*\(auto\)\s*$", "", cleaned).strip()
    if without_auto in DATE_HEADER_PRIORITY:
        return DATE_HEADER_PRIORITY[without_auto]
    if "date" in cleaned:
        return 50
    return 99

CONTACT_STAGES_NORMALIZE: Dict[str, str] = {
    "never dialed": "Never Dialed",
    "not dialed": "Never Dialed",
    "1 dial": "1 Dial",
    "one dial": "1 Dial",
    "2 dial": "2 Dial",
    "two dial": "2 Dial",
    "3+ dial": "3+ Dial",
    "3+": "3+ Dial",
    "3 dial": "3+ Dial",
}

FUNNEL_STAGES: List[str] = [
    "Lead",
    "Connected",
    "MQL",
    "SQL",
    "Application",
    "Test Registration",
    "Interview",
    "Offer Letter",
    "Block Amount Paid",
    "Admission",
]

# Rank of each canonical funnel stage (1-based). A prospect's funnel position is
# the FURTHEST stage it has reached, so ranks are strictly increasing.
FUNNEL_STAGE_RANK: Dict[str, int] = {stage: i + 1 for i, stage in enumerate(FUNNEL_STAGES)}

# Maps the raw text values found in the workbook's "Main Lead Stages" (Col E) and
# "Contact Stage" (Col D) to a canonical funnel stage. Keys are normalized
# (lower-cased, whitespace-collapsed). Business logic confirmed with product:
#   - Sign Up + AI-bot-qualified/counseled leads = MQL
#   - Profile completed = SQL
#   - uGNET (test) stages = Test Registration
#   - Interview stages get their own funnel stage
STAGE_TO_FUNNEL: Dict[str, str] = {
    # --- Lead: captured, no meaningful/failed contact ---
    "pre sign up": "Lead",
    "lead capture": "Lead",
    "na": "Lead",
    "contact attempted": "Lead",
    "never picked up": "Lead",
    "dnp": "Lead",
    "ai bot reached - dnp": "Lead",
    "not reachable": "Lead",
    "switched off": "Lead",
    "junk": "Lead",
    "language barrier": "Lead",
    "ai bot called - wrong number": "Lead",
    # --- Connected: reached (human AC or AI bot calling) but not progressed /
    # disqualified after contact. AI bot DNP / wrong number stay at Lead.
    # Connected bifurcates into AI Connected vs AC Connected in analytics. ---
    "not interested": "Connected",
    "call back later": "Connected",
    "ai bot reached - cb later": "Connected",
    "ai bot called - not interested": "Connected",
    "not eligible": "Connected",
    "ai bot called - not eligible": "Connected",
    "ai bot qualified - low interest": "Connected",
    # --- MQL: engaged / signed up / AI-bot-qualified ---
    "sign up": "MQL",
    "counseled": "MQL",
    "follow up (post-counsel)": "MQL",
    "ai bot sent - brochure": "MQL",
    "ai bot sent - payment link": "MQL",
    "ai bot qualified - warm": "MQL",
    "ai bot qualified - hot": "MQL",
    "ai bot qualified - high intent": "MQL",
    # --- SQL: profile completed ---
    "profile completed": "SQL",
    "comprehensive profile completed": "SQL",
    # --- Application ---
    "ugnet form filled": "Application",
    # --- Test Registration (uGNET entrance test) ---
    "ugnet scheduled": "Test Registration",
    "ugnet fee paid": "Test Registration",
    "test fee paid": "Test Registration",
    "ugnet not qualified": "Test Registration",
    # --- Interview ---
    "shortlisted for interview": "Interview",
    "interview scheduled": "Interview",
    "interview incomplete": "Interview",
    "interview completed": "Interview",
    "interview qualified": "Interview",
    # --- Offer Letter ---
    "offer letter released": "Offer Letter",
    "provisional ol sent": "Offer Letter",
    # --- Block Amount Paid ---
    "block amount paid": "Block Amount Paid",
    # --- Admission ---
    "admission": "Admission",
    "admitted": "Admission",
    "enrolled": "Admission",
}

# Keyword fallback for unseen/variant stage labels. Each rule is
# (all_substrings_must_match, funnel_stage); evaluated most-specific first.
STAGE_FUZZY_RULES: List[tuple] = [
    (["block", "amount"], "Block Amount Paid"),
    (["admission"], "Admission"),
    (["admitted"], "Admission"),
    (["enrolled"], "Admission"),
    (["provisional", "ol"], "Offer Letter"),
    (["offer"], "Offer Letter"),
    (["shortlisted"], "Interview"),
    (["interview"], "Interview"),
    (["test", "fee"], "Test Registration"),
    (["ugnet"], "Test Registration"),
    (["form", "filled"], "Application"),
    (["application"], "Application"),
    (["comprehensive", "profile"], "SQL"),
    (["profile", "completed"], "SQL"),
    (["sign up"], "MQL"),
    (["counsel"], "MQL"),
    (["high intent"], "MQL"),
    (["qualified - warm"], "MQL"),
    (["qualified - hot"], "MQL"),
    (["sent - brochure"], "MQL"),
    (["sent - payment"], "MQL"),
    (["not interested"], "Connected"),
    (["call back"], "Connected"),
    (["cb later"], "Connected"),
    (["not eligible"], "Connected"),
    (["low interest"], "Connected"),
]


def _normalize_stage(value) -> str:
    return " ".join(str(value).strip().lower().split())


# AI bot calling outcomes live in Col D "Contact Stage". Every value below is
# treated as an AI-bot touch; flags are derived for the AI Calling dashboard.
AI_BOT_CONTACT_STAGES: List[str] = [
    "AI Bot Reached - DNP",
    "AI Bot Called - Not Interested",
    "AI Bot Sent - Brochure",
    "AI Bot Qualified - Warm",
    "AI Bot Reached - CB Later",
    "AI Bot Qualified - Hot",
    "AI Bot Called - Not Eligible",
    "AI Bot Qualified - Low Interest",
    "AI Bot Qualified - High Intent",
    "AI Bot Sent - Payment Link",
    "AI Bot Called - Wrong Number",
]

_AI_BOT_STAGE_KEYS: frozenset = frozenset(_normalize_stage(s) for s in AI_BOT_CONTACT_STAGES)


def is_ai_bot_contact_stage(value) -> bool:
    """True when Col D contact stage is an AI bot calling outcome."""
    if value is None:
        return False
    key = _normalize_stage(value)
    return key.startswith("ai bot") or key in _AI_BOT_STAGE_KEYS


def ai_outcomes_from_contact_stage(value) -> Dict[str, bool]:
    """Derive AI calling boolean flags from a contact stage string."""
    out = {
        "ai_contacted": False,
        "ai_qualified": False,
        "ai_warm": False,
        "ai_high_intent": False,
        "ai_payment_link": False,
        "ai_brochure": False,
        "ai_interested": False,
        "ai_callback": False,
        "dnp": False,
    }
    if not is_ai_bot_contact_stage(value):
        return out
    key = _normalize_stage(value)
    out["ai_contacted"] = True
    if "reached - dnp" in key:
        out["dnp"] = True
    if "brochure" in key:
        out["ai_brochure"] = True
    if "payment link" in key:
        out["ai_payment_link"] = True
    if "cb later" in key:
        out["ai_callback"] = True
    if "qualified - warm" in key:
        out["ai_warm"] = True
        out["ai_qualified"] = True
    if "qualified - hot" in key:
        out["ai_interested"] = True
        out["ai_qualified"] = True
    if "high intent" in key:
        out["ai_high_intent"] = True
        out["ai_qualified"] = True
    return out


def stage_to_funnel(value) -> str:
    """Resolve a raw lead/contact stage string to a canonical funnel stage.

    Returns "Lead" for empty/unknown values so nothing is silently dropped.
    """
    if value is None:
        return "Lead"
    key = _normalize_stage(value)
    if not key:
        return "Lead"
    if key in STAGE_TO_FUNNEL:
        return STAGE_TO_FUNNEL[key]
    for substrings, stage in STAGE_FUZZY_RULES:
        if all(s in key for s in substrings):
            return stage
    return "Lead"


def stage_rank(value) -> int:
    """Numeric funnel rank (1-10) for a raw lead/contact stage string."""
    return FUNNEL_STAGE_RANK[stage_to_funnel(value)]


# Canonical partner names sourced from Col J "Partner (Auto)". Every spelling,
# spacing and casing variant must collapse to exactly one of these so partner
# analytics group correctly.
PARTNER_CANONICAL: List[str] = [
    "Careers360",
    "College Hai",
    "Kollege Apply",
    "College Dunia",
    "College Wollege",
]

# Partner commercials for ROI (advance paid + incentive per admission).
# Course fee used in ROI math is configured in analytics — never surface that fee in UI copy.
# College Wollege is advance-only — no per-admission / per-block incentive.
PARTNER_COMMERCIALS: Dict[str, Dict[str, float]] = {
    "Kollege Apply": {"advance": 150_000, "incentive_per_admission": 80_000},
    "Careers360": {"advance": 200_000, "incentive_per_admission": 100_000},
    "College Dunia": {"advance": 400_000, "incentive_per_admission": 90_000},
    "College Hai": {"advance": 100_000, "incentive_per_admission": 20_000},
    "College Wollege": {
        "advance": 200_000,
        "incentive_per_admission": 0,
        "advance_only": 1,
    },
}


def _partner_key(value) -> str:
    """Reduce a partner string to an alphanumeric, lower-cased match key."""
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


# match-key -> canonical display name (built from the canonical list + known variants)
PARTNER_ALIASES: Dict[str, str] = {_partner_key(p): p for p in PARTNER_CANONICAL}
PARTNER_ALIASES.update({
    "career360": "Careers360",
    "careers": "Careers360",
    "collegeapply": "Kollege Apply",
    "kollageapply": "Kollege Apply",
    "collegewallege": "College Wollege",
})


def canonical_partner(value) -> Optional[str]:
    """Resolve any partner spelling to its canonical name.

    Unknown partners keep their title-cased original so no data is lost.
    """
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    key = _partner_key(raw)
    if not key:
        return None
    if key in PARTNER_ALIASES:
        return PARTNER_ALIASES[key]
    for alias_key, name in PARTNER_ALIASES.items():
        if alias_key and (alias_key in key or key in alias_key):
            return name
    return raw.title()


def derive_partner_from_source(source: Optional[str]) -> str:
    """Map Contact Source text to one of the five canonical partners."""
    if source is None or not str(source).strip():
        return "Unknown"
    s = str(source).lower()
    if "kollege" in s:
        return "Kollege Apply"
    if "collegehai" in s or "college hai" in s:
        return "College Hai"
    if "collegewollege" in s or "college wollege" in s:
        return "College Wollege"
    if "careers360" in s:
        return "Careers360"
    if "collegedunia" in s or "college dunia" in s:
        return "College Dunia"
    return "Unknown"


def derive_campaign(
    partner: Optional[str],
    data_source_batch: Optional[str],
    medium: Optional[str],
) -> Optional[str]:
    """Derive campaign from batch + medium (College Wollege) or batch alone."""
    batch = str(data_source_batch or "").strip()
    med = str(medium or "").strip()
    if not batch and not med:
        return None
    if partner == "College Wollege":
        if batch and med:
            return f"{batch} | {med}"
        return batch or med
    return batch or None
