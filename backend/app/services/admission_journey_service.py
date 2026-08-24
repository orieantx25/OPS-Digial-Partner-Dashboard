"""Isolated admission-journey store: All Payments + block + LMS + LSQ lookup.

Never writes MASTER_DATASET and never calls process_lsq_sync_batch.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from typing import Any, Callable, Dict, List, NamedTuple, Optional, Tuple

import polars as pl

from app.config import Settings, get_settings
from app.domain.schema import (
    ADMISSION_JOURNEY_BOOLEAN_COLUMNS,
    ADMISSION_JOURNEY_COLUMNS,
    ADMISSION_JOURNEY_META_FILE,
    ADMISSION_JOURNEY_PARQUET_FILE,
    ADMISSION_JOURNEY_TABLE,
    ADMISSIONS_LMS_TABLE,
    ADMISSIONS_TABLE,
    BLOCK_PAYMENT_TABLE,
    PARTNER_CANONICAL,
    REFUND_TABLE,
    canonical_partner,
    derive_partner_from_source,
    is_digital_partner,
    stage_rank,
    stage_to_funnel,
)
from app.infrastructure.duckdb_repo import DuckDBRepository
from app.logging_config import get_logger
from app.services.analytics_service import BLOCK_CLASH_LEAD_CUTOFF
from app.services.block_payment_service import normalize_match_email
from app.services.ingestion_service import phone_last10
from app.services.leadsquared_client import LeadSquaredClient
from app.services.leadsquared_mapper import lead_include_csv

logger = get_logger(__name__)

JOURNEY_LSQ_FIELDS = [
    "ProspectID",
    "EmailAddress",
    "Phone",
    "FirstName",
    "LastName",
    "Source",
    "SourceMedium",
    "SourceCampaign",
    "ProspectStage",
    "mx_Main_Lead_Stages",
    "mx_Test_Registration",
    "mx_Admission",
    "CreatedOn",
    "ModifiedOn",
]

CHANNEL_DIGITAL_PARTNER = "digital_partner"
CHANNEL_COUNSELLOR = "counsellor"
CHANNEL_OTHER = "other"
CHANNEL_UNMATCHED = "unmatched_lsq"

CLASH_NOTE = (
    "If created or paid before 6 Jun 2026 the lead belongs to original UTM campaign "
    "or contact source. Clash if counsellor payment, or UGNET/test after that date."
)


def _clash_note(clash: bool, clash_at_block: bool, clash_at_admission: bool) -> Optional[str]:
    if not clash:
        return None
    parts: List[str] = []
    if clash_at_block:
        parts.append("Clash at block amount")
    if clash_at_admission:
        parts.append("Clash at admission")
    if not parts:
        parts.append("Clash at UGNET / test registration")
    return " · ".join(parts) + ". " + CLASH_NOTE


def _clash_original_party(*values: Any) -> str:
    for value in values:
        text = _blank(value)
        if not text:
            continue
        partner = derive_partner_from_source(text)
        if is_digital_partner(partner):
            return partner
        partner = canonical_partner(text)
        if is_digital_partner(partner):
            return partner
        if looks_like_digital_partner(text):
            return text
    return "Digital Partner"


def _clash_other_party(
    source_at_payment: Any = None,
    campaign_at_payment: Any = None,
    *ugnet_values: Any,
) -> str:
    if is_counsellor_payment_source(source_at_payment, campaign_at_payment):
        return "Counsellor"
    if looks_like_ugnet_or_test(source_at_payment, campaign_at_payment, *ugnet_values):
        return "UGNET / test"
    pay = _blank(source_at_payment) or _blank(campaign_at_payment)
    return pay or "Other"


def format_clash_at_with(
    *,
    clash: bool,
    clash_at_block: bool,
    clash_at_admission: bool,
    lsq_source: Any = None,
    contact_source_sheet: Any = None,
    original_utm_campaign: Any = None,
    original_utm_medium: Any = None,
    lsq_campaign: Any = None,
    source_at_payment: Any = None,
    campaign_at_payment: Any = None,
    lsq_prospect_stage: Any = None,
    lsq_lead_stage: Any = None,
) -> Optional[str]:
    """Where the clash is and who it is with (original DP vs counsellor / UGNET)."""
    if not clash:
        return None
    where: List[str] = []
    if clash_at_block:
        where.append("Block")
    if clash_at_admission:
        where.append("Admission")
    if not where:
        where.append("UGNET / test")
    original = _clash_original_party(
        lsq_source,
        contact_source_sheet,
        original_utm_campaign,
        lsq_campaign,
        original_utm_medium,
    )
    other = _clash_other_party(
        source_at_payment,
        campaign_at_payment,
        lsq_prospect_stage,
        lsq_lead_stage,
    )
    return f"{' · '.join(where)} · {other} | {original}"

PATH_STEPS: List[Tuple[str, str]] = [
    ("created", "Created"),
    ("contact_source", "Original contact source"),
    ("original_utm", "Original UTM"),
    ("utm_activity", "UTM activity"),
    ("lsq_stage", "LSQ current stage"),
    ("payment_source", "Test payment source"),
    ("amounts", "Amounts"),
    ("recent_utm", "Recent UTM"),
    ("campus", "Campus"),
]

STAGE_CHIPS: List[Tuple[str, str]] = [
    ("created", "Created"),
    ("pipeline", "Connected / MQL / SQL"),
    ("offer", "Offer"),
    ("block", "Block paid"),
    ("sem", "Sem fee / LMS"),
]

EXPORT_CSV_COLUMNS: List[str] = [
    "journey_id",
    "name",
    "email",
    "phone",
    "campus",
    "campus_code",
    "college_code",
    "college_name",
    "channel",
    "lsq_matched",
    "unmatched_lsq",
    "clash",
    "clash_at_block",
    "clash_at_admission",
    "clash_note",
    "clash_with",
    "sheet_paid",
    "sheet_status",
    "amount_inr",
    "sem_utr",
    "paid_at",
    "dop",
    "block_amount",
    "block_payment_status",
    "block_utr",
    "block_payment_done",
    "source_at_payment",
    "campaign_at_payment",
    "lms_status",
    "lms_payable_inr",
    "lms_verified_paid_inr",
    "lms_utr",
    "lms_submitted_on",
    "lms_verified_on",
    "lms_paid_on",
    "sem_fee_under_review",
    "sem_fee_verified",
    "refund_case",
    "refund_status",
    "lsq_prospect_id",
    "lsq_created_on",
    "lsq_modified_on",
    "lsq_source",
    "lsq_medium",
    "lsq_campaign",
    "lsq_prospect_stage",
    "lsq_lead_stage",
    "lsq_stage_label",
    "contact_source_sheet",
    "original_utm_medium",
    "original_utm_campaign",
    "sheet_created_at",
    "sheet_updated_at",
    *[
        col
        for key, _ in PATH_STEPS
        for col in (
            f"step_{key}_lsq",
            f"step_{key}_sheet",
            f"step_{key}_date",
            f"step_{key}_mismatch",
            f"step_{key}_empty",
            f"step_{key}_fields",
        )
    ],
    *[
        col
        for key, _ in STAGE_CHIPS
        for col in (f"stage_{key}_reached", f"stage_{key}_at", f"stage_{key}_detail")
    ],
    "events",
]

ProgressFn = Callable[[Dict[str, Any]], None]


def journey_include_csv() -> str:
    return lead_include_csv(extra_fields=JOURNEY_LSQ_FIELDS)


def make_journey_id(sheet_id: Any, email: Any, phone: Any) -> str:
    raw = "|".join(
        [
            str(sheet_id or "").strip(),
            str(email or "").strip().lower(),
            phone_last10(phone) or "",
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


_NON_CLASH_CAMPAIGNS = frozenset(
    c.lower()
    for c in (
        "youtube",
        "fb",
        "google",
        "not_set",
        "Brand_search",
        "Lead_search",
        "upgrad",
        "upgrad_home",
        "new_leads_prospecting",
        "sign_up",
        "leads_prospecting",
        "ugsot_internal",
    )
)


def _is_non_clash_campaign(campaign_at_payment: Any) -> bool:
    text = str(campaign_at_payment or "").strip().lower()
    return text in _NON_CLASH_CAMPAIGNS


_CLASH_SOURCE_AT_PAYMENT_TOKENS = ("counsell", "influencer")


def _is_clash_payment_source(source_at_payment: Any) -> bool:
    text = str(source_at_payment or "").strip().lower()
    return any(token in text for token in _CLASH_SOURCE_AT_PAYMENT_TOKENS)


def is_counsellor_payment_source(*values: Any) -> bool:
    for value in values:
        if "counsell" in str(value or "").lower():
            return True
    return False


_UGNET_TEST_TOKENS = (
    "ugnet",
    "u-gnet",
    "u gnet",
    "test registration",
    "test registered",
    "test fee",
    "test taker",
    "one time",
    "onetime",
    "one-time",
)


def looks_like_ugnet_or_test(*values: Any) -> bool:
    blob = " ".join(_blank(v).lower() for v in values if v is not None)
    if not blob.strip():
        return False
    return any(token in blob for token in _UGNET_TEST_TOKENS)


def date_before_cutoff(*values: Any) -> bool:
    for value in values:
        parsed = coerce_lead_created_date(value)
        if parsed is not None and parsed < BLOCK_CLASH_LEAD_CUTOFF:
            return True
    return False


def date_on_or_after_cutoff(*values: Any) -> bool:
    for value in values:
        parsed = coerce_lead_created_date(value)
        if parsed is not None and parsed >= BLOCK_CLASH_LEAD_CUTOFF:
            return True
    return False


class ClashVerdict(NamedTuple):
    is_clash: bool
    clash_at_block: bool
    clash_at_admission: bool
    belongs_to_original: bool
    note: Optional[str]


def coerce_lead_created_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def parse_event_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    text = str(value).strip()
    if not text:
        return None
    normalized = text.replace("Z", "").replace(" ", "T", 1)
    for candidate in (normalized[:26], normalized[:19], normalized[:10]):
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            continue
    return None


def build_journey_events(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    candidates = [
        ("Lead created", row.get("lsq_created_on")),
        ("Last LSQ activity", row.get("lsq_modified_on")),
        ("Sheet created", row.get("sheet_created_at")),
        ("Sheet updated", row.get("sheet_updated_at")),
        ("LMS submitted", row.get("lms_submitted_on")),
        ("LMS paid", row.get("lms_paid_on")),
        ("LMS verified", row.get("lms_verified_on")),
        ("Semester paid", row.get("paid_at")),
        ("DOP", row.get("dop") if _blank(row.get("dop")) != _blank(row.get("paid_at")) else None),
    ]
    events: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()
    for label, raw in candidates:
        at = _display(raw)
        parsed = parse_event_datetime(at)
        if not at or parsed is None:
            continue
        key = (label, at)
        if key in seen:
            continue
        seen.add(key)
        events.append({"key": label.lower().replace(" ", "_"), "label": label, "at": at})
    events.sort(key=lambda item: parse_event_datetime(item["at"]) or datetime.min)
    return events


def looks_like_digital_partner(*values: Any) -> bool:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        if is_digital_partner(derive_partner_from_source(text)):
            return True
        if is_digital_partner(canonical_partner(text)):
            return True
        lowered = text.lower()
        for partner in PARTNER_CANONICAL:
            if partner.lower() in lowered:
                return True
    return False


def classify_channel(
    lsq_matched: bool,
    lsq_source: Any,
    source_at_payment: Any,
    original_utm_medium: Any = None,
    original_utm_campaign: Any = None,
    *,
    contact_source_sheet: Any = None,
    lsq_campaign: Any = None,
    campaign_at_payment: Any = None,
    created_on: Any = None,
    paid_at: Any = None,
) -> str:
    if not lsq_matched:
        return CHANNEL_UNMATCHED
    dp_original = looks_like_digital_partner(
        lsq_source,
        contact_source_sheet,
        original_utm_campaign,
        original_utm_medium,
        lsq_campaign,
    )
    if dp_original and date_before_cutoff(created_on, paid_at):
        return CHANNEL_DIGITAL_PARTNER
    if is_counsellor_payment_source(source_at_payment, campaign_at_payment):
        return CHANNEL_COUNSELLOR
    if looks_like_digital_partner(
        lsq_source,
        source_at_payment,
        campaign_at_payment,
        original_utm_medium,
        original_utm_campaign,
        lsq_campaign,
        contact_source_sheet,
    ):
        return CHANNEL_DIGITAL_PARTNER
    return CHANNEL_OTHER


def classify_lead_clash(
    *,
    lsq_source: Any = None,
    contact_source_sheet: Any = None,
    original_utm_medium: Any = None,
    original_utm_campaign: Any = None,
    lsq_campaign: Any = None,
    source_at_payment: Any = None,
    campaign_at_payment: Any = None,
    created_on: Any = None,
    paid_at: Any = None,
    dop: Any = None,
    lsq_prospect_stage: Any = None,
    lsq_lead_stage: Any = None,
    lsq_test_registration: Any = None,
    lsq_admission: Any = None,
    utm_activity: Any = None,
    lms_status: Any = None,
    lms_submitted_on: Any = None,
    lms_paid_on: Any = None,
    lsq_modified_on: Any = None,
    sheet_is_paid: bool = False,
    block_amount_paid_sheet: Any = None,
    block_payment_status: Any = None,
    on_block_sheet: bool = False,
) -> ClashVerdict:
    dp_original = looks_like_digital_partner(
        lsq_source,
        contact_source_sheet,
        original_utm_campaign,
        original_utm_medium,
        lsq_campaign,
    )
    if not dp_original:
        return ClashVerdict(False, False, False, False, None)

    belongs = date_before_cutoff(created_on, paid_at, dop)

    # Clash is determined solely by source_at_payment containing
    # counsellor or influencer. Sales and other sources are captured, not clash.
    clash_source = _is_clash_payment_source(source_at_payment)
    if not clash_source:
        return ClashVerdict(False, False, False, belongs, None)

    rank = max(stage_rank(lsq_prospect_stage), stage_rank(lsq_lead_stage))
    on_lms = bool(_blank(lms_status) or lms_submitted_on or lms_paid_on)
    reached_admission = bool(
        sheet_is_paid
        or on_lms
        or _as_bool(lsq_admission)
        or rank >= stage_rank("Admission")
    )
    clash_block = belongs and on_block_sheet
    clash_admission = reached_admission and clash_source
    parts: List[str] = []
    if clash_block:
        parts.append("Clash at block amount")
    if clash_admission:
        parts.append("Clash at admission")
    if not parts:
        parts.append("Clash (payment source)")
    return ClashVerdict(True, clash_block, clash_admission, belongs, " · ".join(parts))


def is_counsellor_clash(
    source_at_payment: Any,
    lsq_source: Any,
    original_utm_medium: Any,
    original_utm_campaign: Any,
    created_on: Any,
    campaign_at_payment: Any = None,
    contact_source_sheet: Any = None,
    lsq_campaign: Any = None,
    paid_at: Any = None,
    **kwargs: Any,
) -> bool:
    return classify_lead_clash(
        source_at_payment=source_at_payment,
        campaign_at_payment=campaign_at_payment,
        lsq_source=lsq_source,
        contact_source_sheet=contact_source_sheet,
        original_utm_medium=original_utm_medium,
        original_utm_campaign=original_utm_campaign,
        lsq_campaign=lsq_campaign,
        created_on=created_on,
        paid_at=paid_at,
        **kwargs,
    ).is_clash


def _blank(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in {"none", "null", "nan"}:
        return ""
    return text


def _display(value: Any) -> Optional[str]:
    text = _blank(value)
    return text or None


BLOCK_FULL_AMOUNT_INR = 500


def _block_amount_sql(column: str = "block_amount_paid_sheet") -> str:
    """DuckDB expression: parse sheet block amount to a number."""
    return (
        f"TRY_CAST(NULLIF(regexp_replace("
        f"replace(replace(COALESCE({column}, ''), ',', ''), '₹', ''), "
        f"'[^0-9.]', ''), '') AS DOUBLE)"
    )


def _block_status_filter_sql(kind: str) -> str:
    """SQL for full/partial using sheet status first, else amount > ₹500 = Full."""
    status = "LOWER(COALESCE(block_payment_status, ''))"
    amount = _block_amount_sql()
    has_full = f"({status} LIKE '%full%' AND {status} NOT LIKE '%partial%' AND {status} NOT LIKE '%partly%')"
    has_partial = f"({status} LIKE '%partial%' OR {status} LIKE '%partly%')"
    no_fp = f"(NOT {has_full} AND NOT {has_partial})"
    if kind in {"full", "full_payment"}:
        return f"({has_full} OR ({no_fp} AND {amount} > {BLOCK_FULL_AMOUNT_INR}))"
    if kind in {"partial", "partial_payment"}:
        return (
            f"({has_partial} OR ({no_fp} AND {amount} IS NOT NULL "
            f"AND {amount} > 0 AND {amount} <= {BLOCK_FULL_AMOUNT_INR}))"
        )
    raise ValueError(f"Unknown block status filter: {kind}")


def _parse_amount_inr(value: Any) -> Optional[float]:
    text = _blank(value)
    if not text:
        return None
    cleaned = (
        text.replace(",", "")
        .replace("₹", "")
        .replace("rs.", "")
        .replace("rs", "")
        .replace("inr", "")
        .strip()
        .lower()
    )
    # Keep leading digits / decimal only.
    num = ""
    for ch in cleaned:
        if ch.isdigit() or ch == ".":
            num += ch
        elif num:
            break
    if not num:
        return None
    try:
        return float(num)
    except ValueError:
        return None


def _full_or_partial_from_text(status: Any) -> Optional[str]:
    text = _blank(status).lower()
    if not text:
        return None
    if "partial" in text or "partly" in text:
        return "Partial Payment"
    if "full" in text:
        return "Full Payment"
    return None


def resolve_block_payment_status(status: Any = None, amount: Any = None) -> Optional[str]:
    """Prefer sheet full/partial; else amount above ₹500 = Full, else Partial if > 0."""
    from_sheet = _full_or_partial_from_text(status)
    if from_sheet:
        return from_sheet
    amt = _parse_amount_inr(amount)
    if amt is not None and amt > 0:
        if amt > BLOCK_FULL_AMOUNT_INR:
            return "Full Payment"
        return "Partial Payment"
    return _display(status)


def _norm_compare(value: Any) -> str:
    return " ".join(_blank(value).lower().split())


def _mismatch(left: Any, right: Any) -> bool:
    a = _norm_compare(left)
    b = _norm_compare(right)
    return bool(a and b and a != b)


def _compare_field(label: str, lsq: Any = None, sheet: Any = None) -> Dict[str, Any]:
    lsq_val = _display(lsq)
    sheet_val = _display(sheet)
    return {
        "label": label,
        "lsq": lsq_val,
        "sheet": sheet_val,
        "mismatch": _mismatch(lsq_val, sheet_val),
        "empty": not (lsq_val or sheet_val),
    }


def _pick_lead(rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not rows:
        return None
    return rows[0]


def _index_by_email_phone(rows: List[Dict[str, Any]]) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    by_email: Dict[str, Dict[str, Any]] = {}
    by_phone: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        email = _blank(row.get("match_email") or row.get("email")).lower()
        if email and email not in by_email:
            by_email[email] = row
        phone = phone_last10(row.get("match_phone") or row.get("phone"))
        if phone and phone not in by_phone:
            by_phone[phone] = row
    return by_email, by_phone


def _match_side(
    row: Dict[str, Any],
    by_email: Dict[str, Dict[str, Any]],
    by_phone: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    email = _blank(row.get("match_email") or row.get("email")).lower()
    if email and email in by_email:
        return by_email[email]
    phone = phone_last10(row.get("match_phone") or row.get("phone"))
    if phone and phone in by_phone:
        return by_phone[phone]
    return {}


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"true", "1", "yes"}


def _funnel_rank(row: Dict[str, Any]) -> int:
    return max(
        stage_rank(row.get("lsq_prospect_stage")),
        stage_rank(row.get("lsq_lead_stage")),
    )


def format_lsq_stages(*values: Any) -> Optional[str]:
    ordered: List[Tuple[int, str]] = []
    seen: set[str] = set()
    for value in values:
        text = _display(value)
        if not text:
            continue
        key = _norm_compare(text)
        if key in seen:
            continue
        seen.add(key)
        ordered.append((stage_rank(text), text))
    ordered.sort(key=lambda item: item[0])
    return _join_nonempty(*(text for _, text in ordered))


def journey_status_flags(row: Dict[str, Any], refund: Optional[Dict[str, Any]] = None) -> Dict[str, bool]:
    rank = _funnel_rank(row)
    block_done = bool(
        rank >= stage_rank("Block Amount Paid")
        or _blank(row.get("block_payment_status")).lower()
        in {
            "paid",
            "success",
            "completed",
            "full payment",
            "partial payment",
            "partly paid",
        }
        or "full payment" in _blank(row.get("block_payment_status")).lower()
        or "partial" in _blank(row.get("block_payment_status")).lower()
        or _blank(row.get("block_amount_paid_sheet"))
        or _blank(row.get("block_amount"))
    )
    sheet_paid = _as_bool(row.get("sheet_is_paid"))
    lms = _blank(row.get("lms_status")).lower()
    sem_verified = lms in {"verified", "verify", "approved"} or "verif" in lms
    refund_row = refund or {}
    refund_text = _blank(
        row.get("refund_status") or refund_row.get("final_status") or refund_row.get("status_finance")
    ).lower()
    refund_case = bool(
        _as_bool(refund_row.get("is_refund"))
        or (
            refund_text
            and refund_text not in {"no", "none", "na", "n/a", "not refund"}
            and "not refund" not in refund_text
        )
    )
    return {
        "block_payment_done": block_done,
        "sem_fee_under_review": sheet_paid and not sem_verified,
        "sem_fee_verified": sem_verified,
        "refund_case": refund_case,
    }


def _join_nonempty(*parts: Any, sep: str = " · ") -> Optional[str]:
    values = [_blank(p) for p in parts if _blank(p)]
    if not values:
        return None
    return sep.join(values)


class AdmissionJourneyService:
    """Build and query the isolated admission_journey parquet."""

    def __init__(
        self,
        duck_repo: Optional[DuckDBRepository] = None,
        settings: Optional[Settings] = None,
        lsq_client: Optional[LeadSquaredClient] = None,
    ):
        self.settings = settings or get_settings()
        self.duck_repo = duck_repo or DuckDBRepository(self.settings)
        self.parquet_path = self.settings.parquet_dir / ADMISSION_JOURNEY_PARQUET_FILE
        self.meta_path = self.settings.parquet_dir / ADMISSION_JOURNEY_META_FILE
        self._lsq_client = lsq_client
        self._sync_lock = threading.Lock()

    def _client(self) -> LeadSquaredClient:
        if self._lsq_client is not None:
            return self._lsq_client
        return LeadSquaredClient(self.settings)

    def _lsq_keys_available(self) -> bool:
        return bool(
            self.settings.leadsquared_access_key.strip()
            and self.settings.leadsquared_secret_key.strip()
        )

    def get_status(self) -> Dict[str, Any]:
        meta: Dict[str, Any] = {}
        if self.meta_path.exists():
            try:
                meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}

        has_data = self.duck_repo.admission_journey_exists()
        row_count = int(meta.get("row_count") or 0)
        unmatched_lsq = int(meta.get("unmatched_lsq") or 0)
        clash_count = int(meta.get("clash_count") or 0)
        clash_at_block = int(meta.get("clash_at_block") or 0)
        clash_at_admission = int(meta.get("clash_at_admission") or 0)
        paid_count = int(meta.get("paid_count") or 0)
        dp_count = int(meta.get("dp_count") or 0)
        counsellor_count = int(meta.get("counsellor_count") or 0)
        other_count = int(meta.get("other_count") or 0)
        block_full_count = int(meta.get("block_full_count") or 0)
        block_partial_count = int(meta.get("block_partial_count") or 0)
        campuses: List[str] = list(meta.get("campuses") or [])

        if has_data:
            try:
                stats = self.duck_repo.query_dicts(
                    f"""
                    SELECT
                      COUNT(*) AS row_count,
                      SUM(CASE WHEN lsq_matched THEN 0 ELSE 1 END) AS unmatched_lsq,
                      SUM(CASE WHEN is_clash THEN 1 ELSE 0 END) AS clash_count,
                      SUM(CASE WHEN clash_at_block THEN 1 ELSE 0 END) AS clash_at_block,
                      SUM(CASE WHEN clash_at_admission THEN 1 ELSE 0 END) AS clash_at_admission,
                      SUM(CASE WHEN sheet_is_paid THEN 1 ELSE 0 END) AS paid_count,
                      SUM(CASE WHEN channel = '{CHANNEL_DIGITAL_PARTNER}' THEN 1 ELSE 0 END) AS dp_count,
                      SUM(CASE WHEN channel = '{CHANNEL_COUNSELLOR}' THEN 1 ELSE 0 END) AS counsellor_count,
                      SUM(CASE WHEN channel = '{CHANNEL_OTHER}' THEN 1 ELSE 0 END) AS other_count,
                      SUM(CASE WHEN {_block_status_filter_sql('full')} THEN 1 ELSE 0 END) AS block_full_count,
                      SUM(CASE WHEN {_block_status_filter_sql('partial')} THEN 1 ELSE 0 END) AS block_partial_count
                    FROM {ADMISSION_JOURNEY_TABLE}
                    """
                )
                if stats:
                    row_count = int(stats[0].get("row_count") or 0)
                    unmatched_lsq = int(stats[0].get("unmatched_lsq") or 0)
                    clash_count = int(stats[0].get("clash_count") or 0)
                    clash_at_block = int(stats[0].get("clash_at_block") or 0)
                    clash_at_admission = int(stats[0].get("clash_at_admission") or 0)
                    paid_count = int(stats[0].get("paid_count") or 0)
                    dp_count = int(stats[0].get("dp_count") or 0)
                    counsellor_count = int(stats[0].get("counsellor_count") or 0)
                    other_count = int(stats[0].get("other_count") or 0)
                    block_full_count = int(stats[0].get("block_full_count") or 0)
                    block_partial_count = int(stats[0].get("block_partial_count") or 0)
                campus_rows = self.duck_repo.query_dicts(
                    f"""
                    SELECT DISTINCT COALESCE(NULLIF(TRIM(campus_code), ''), college_code) AS campus
                    FROM {ADMISSION_JOURNEY_TABLE}
                    WHERE COALESCE(campus_code, college_code, '') <> ''
                    ORDER BY 1
                    """
                )
                campuses = [str(r["campus"]) for r in campus_rows if r.get("campus")]
            except Exception:
                pass

        return {
            "has_data": has_data,
            "row_count": row_count,
            "unmatched_lsq": unmatched_lsq,
            "clash_count": clash_count,
            "clash_at_block": clash_at_block,
            "clash_at_admission": clash_at_admission,
            "paid_count": paid_count,
            "unpaid_count": max(row_count - paid_count, 0),
            "dp_count": dp_count,
            "counsellor_count": counsellor_count,
            "other_count": other_count,
            "block_full_count": block_full_count,
            "block_partial_count": block_partial_count,
            "campuses": campuses,
            "last_synced_at": meta.get("synced_at"),
            "admissions_loaded": self.duck_repo.admissions_exists(),
            "lsq_configured": self._lsq_keys_available(),
            "clash_cutoff": BLOCK_CLASH_LEAD_CUTOFF.isoformat(),
        }

    def sync(self, progress: Optional[ProgressFn] = None) -> Dict[str, Any]:
        if not self._sync_lock.acquire(blocking=False):
            raise ValueError("Admission journey sync is already running")
        try:
            return self._sync_locked(progress)
        finally:
            self._sync_lock.release()

    def _emit(self, progress: Optional[ProgressFn], payload: Dict[str, Any]) -> None:
        if progress:
            progress(payload)

    def _sync_locked(self, progress: Optional[ProgressFn]) -> Dict[str, Any]:
        if not self.duck_repo.admissions_exists():
            raise ValueError(
                "All Payments sheet is not loaded. Run Google/admissions sync first."
            )

        payments = self.duck_repo.query_dicts(f"SELECT * FROM {ADMISSIONS_TABLE}")
        total = len(payments)
        self._emit(
            progress,
            {
                "synced": 0,
                "total": total,
                "failed": 0,
                "unmatched_lsq": 0,
                "message": f"Loaded {total} All Payments rows",
            },
        )

        blocks = (
            self.duck_repo.query_dicts(f"SELECT * FROM {BLOCK_PAYMENT_TABLE}")
            if self.duck_repo.block_payment_exists()
            else []
        )
        lms_rows = (
            self.duck_repo.query_dicts(f"SELECT * FROM {ADMISSIONS_LMS_TABLE}")
            if self.duck_repo.admissions_lms_exists()
            else []
        )
        block_email, block_phone = _index_by_email_phone(blocks)
        lms_email, lms_phone = _index_by_email_phone(lms_rows)

        lookup_keys: List[Tuple[str, str]] = []
        seen_keys: set[Tuple[str, str]] = set()
        for row in payments:
            email = _blank(row.get("match_email") or row.get("email")).lower()
            phone = phone_last10(row.get("match_phone") or row.get("phone")) or ""
            key = (email, phone)
            if key == ("", ""):
                continue
            if key not in seen_keys:
                seen_keys.add(key)
                lookup_keys.append(key)

        lsq_by_email: Dict[str, Dict[str, Any]] = {}
        lsq_by_phone: Dict[str, Dict[str, Any]] = {}
        failed = 0
        if lookup_keys and (self._lsq_client is not None or self._lsq_keys_available()):
            lsq_by_email, lsq_by_phone, failed = self._lookup_lsq(lookup_keys, progress, total)
        elif lookup_keys:
            logger.info("admission_journey_lsq_skipped_no_keys", lookups=len(lookup_keys))

        synced_at = datetime.utcnow().isoformat()
        records: List[Dict[str, Any]] = []
        unmatched = 0
        for row in payments:
            block = _match_side(row, block_email, block_phone)
            lms = _match_side(row, lms_email, lms_phone)
            email = _blank(row.get("match_email") or row.get("email")).lower()
            phone = phone_last10(row.get("match_phone") or row.get("phone")) or ""
            lead = None
            if email and email in lsq_by_email:
                lead = lsq_by_email[email]
            elif phone and phone in lsq_by_phone:
                lead = lsq_by_phone[phone]
            lsq_matched = bool(lead)
            if not lsq_matched:
                unmatched += 1
            records.append(
                self._build_record(row, block, lms, lead or {}, lsq_matched, synced_at)
            )

        frame = self._records_to_frame(records)
        meta = self._write_frame(frame, synced_at, unmatched, failed)
        result = {
            "status": "completed",
            "synced": frame.height,
            "total": total,
            "failed": failed,
            "unmatched_lsq": unmatched,
            "clash_count": meta["clash_count"],
            "message": (
                f"Mapped {frame.height} admission journeys "
                f"({unmatched} unmatched in LSQ)"
            ),
        }
        self._emit(progress, result)
        return result

    def _lookup_lsq(
        self,
        lookup_keys: List[Tuple[str, str]],
        progress: Optional[ProgressFn],
        total_students: int,
    ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]], int]:
        include_csv = journey_include_csv()
        workers = max(1, min(int(getattr(self.settings, "leadsquared_sync_workers", 3) or 3), 5))
        client = self._client()
        owns_client = self._lsq_client is None
        if owns_client:
            client.open()

        by_email: Dict[str, Dict[str, Any]] = {}
        by_phone: Dict[str, Dict[str, Any]] = {}
        failed = 0
        done = 0

        def fetch_one(key: Tuple[str, str]) -> Tuple[Tuple[str, str], Optional[Dict[str, Any]], bool]:
            email, phone = key
            try:
                if email:
                    hit = _pick_lead(
                        client.fetch_leads_by_lookup(
                            "EmailAddress", email, include_csv, page_size=5
                        )
                    )
                    if hit:
                        return key, hit, False
                if phone:
                    for candidate in (phone, f"91{phone}"):
                        hit = _pick_lead(
                            client.fetch_leads_by_lookup(
                                "Phone", candidate, include_csv, page_size=5
                            )
                        )
                        if hit:
                            return key, hit, False
                return key, None, False
            except Exception as exc:
                logger.warning(
                    "admission_journey_lsq_lookup_failed",
                    email=email or None,
                    error=str(exc),
                )
                return key, None, True

        try:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = [pool.submit(fetch_one, key) for key in lookup_keys]
                for future in as_completed(futures):
                    key, lead, is_fail = future.result()
                    email, phone = key
                    if is_fail:
                        failed += 1
                    if lead:
                        if email:
                            by_email[email] = lead
                        if phone:
                            by_phone[phone] = lead
                    done += 1
                    if done % 25 == 0 or done == len(lookup_keys):
                        self._emit(
                            progress,
                            {
                                "synced": done,
                                "total": total_students,
                                "failed": failed,
                                "unmatched_lsq": 0,
                                "message": f"LSQ lookup {done}/{len(lookup_keys)}",
                            },
                        )
        finally:
            if owns_client:
                client.close()

        return by_email, by_phone, failed

    def _build_record(
        self,
        payment: Dict[str, Any],
        block: Dict[str, Any],
        lms: Dict[str, Any],
        lead: Dict[str, Any],
        lsq_matched: bool,
        synced_at: str,
    ) -> Dict[str, Any]:
        email = _blank(payment.get("match_email") or payment.get("email")).lower() or None
        phone = _blank(payment.get("phone") or payment.get("match_phone")) or None
        lsq_source = _display(lead.get("Source"))
        lsq_medium = _display(lead.get("SourceMedium"))
        lsq_campaign = _display(lead.get("SourceCampaign"))
        source_at_payment = _display(block.get("source_at_payment"))
        original_utm_medium = _display(block.get("original_utm_medium"))
        original_utm_campaign = _display(block.get("original_utm_campaign"))
        created_on = _display(lead.get("CreatedOn"))
        contact_source_sheet = _display(block.get("contact_source_sheet"))
        campaign_at_payment = _display(block.get("campaign_at_payment"))
        paid_at = _display(payment.get("paid_at"))
        dop = _display(payment.get("dop"))
        sheet_is_paid = _as_bool(payment.get("is_paid"))
        lms_status = _display(lms.get("status"))
        channel = classify_channel(
            lsq_matched,
            lsq_source,
            source_at_payment,
            original_utm_medium,
            original_utm_campaign,
            contact_source_sheet=contact_source_sheet,
            lsq_campaign=lsq_campaign,
            campaign_at_payment=campaign_at_payment,
            created_on=created_on,
            paid_at=paid_at or dop,
        )
        verdict = classify_lead_clash(
            lsq_source=lsq_source,
            contact_source_sheet=contact_source_sheet,
            original_utm_medium=original_utm_medium,
            original_utm_campaign=original_utm_campaign,
            lsq_campaign=lsq_campaign,
            source_at_payment=source_at_payment,
            campaign_at_payment=campaign_at_payment,
            created_on=created_on,
            paid_at=paid_at,
            dop=dop,
            lsq_prospect_stage=lead.get("ProspectStage"),
            lsq_lead_stage=lead.get("mx_Main_Lead_Stages"),
            lsq_test_registration=lead.get("mx_Test_Registration"),
            lsq_admission=lead.get("mx_Admission"),
            utm_activity=block.get("utm_activity"),
            lms_status=lms_status,
            lms_submitted_on=lms.get("submitted_on"),
            lms_paid_on=lms.get("paid_on"),
            lsq_modified_on=lead.get("ModifiedOn"),
            sheet_is_paid=sheet_is_paid,
            block_amount_paid_sheet=payment.get("block_amount_paid_sheet"),
            block_payment_status=payment.get("block_payment_status"),
            on_block_sheet=bool(
                source_at_payment
                or campaign_at_payment
                or contact_source_sheet
                or original_utm_campaign
                or original_utm_medium
            ),
        )
        first = _blank(lead.get("FirstName"))
        last = _blank(lead.get("LastName"))
        lsq_name = " ".join(p for p in (first, last) if p).strip()
        student_name = (
            _display(payment.get("student_name"))
            or _display(block.get("full_name"))
            or _display(lms.get("candidate_name"))
            or _display(lsq_name)
        )
        return {
            "journey_id": make_journey_id(payment.get("sheet_id"), email, phone),
            "sheet_id": _display(payment.get("sheet_id")),
            "student_name": student_name,
            "email": _display(payment.get("email")) or email,
            "phone": phone,
            "match_email": email,
            "match_phone": phone_last10(phone),
            "campus_code": _display(payment.get("campus_code")),
            "college_code": _display(block.get("college_code")),
            "college_name": _display(block.get("college_name")),
            "sheet_status": _display(payment.get("status")),
            "sheet_is_paid": sheet_is_paid,
            "amount_inr": _display(payment.get("amount_inr")),
            "paid_at": paid_at,
            "dop": dop,
            "sheet_created_at": _display(payment.get("created_at")),
            "sheet_updated_at": _display(payment.get("updated_at")),
            "block_amount_paid_sheet": _display(payment.get("block_amount_paid_sheet")),
            "block_payment_status": resolve_block_payment_status(
                payment.get("block_payment_status"),
                payment.get("block_amount_paid_sheet"),
            ),
            "contact_source_sheet": contact_source_sheet,
            "original_utm_medium": original_utm_medium,
            "original_utm_campaign": original_utm_campaign,
            "utm_activity": _display(block.get("utm_activity")),
            "source_at_payment": source_at_payment,
            "campaign_at_payment": campaign_at_payment,
            "recent_utm": _display(block.get("recent_utm")),
            "lms_status": lms_status,
            "lms_campus": _display(lms.get("campus")),
            "lms_semester": _display(lms.get("semester")),
            "lms_payable_inr": _display(lms.get("payable_inr")),
            "lms_verified_paid_inr": _display(lms.get("verified_paid_inr")),
            "lms_verified_on": _display(lms.get("verified_on")),
            "lms_paid_on": _display(lms.get("paid_on")),
            "lms_submitted_on": _display(lms.get("submitted_on")),
            "lms_utr": _display(lms.get("utr")),
            "sem_utr": _display(payment.get("sem_utr")),
            "block_utr": _display(payment.get("block_utr")),
            "lsq_matched": lsq_matched,
            "lsq_prospect_id": _display(lead.get("ProspectID")),
            "lsq_source": lsq_source,
            "lsq_medium": lsq_medium,
            "lsq_campaign": lsq_campaign,
            "lsq_prospect_stage": _display(lead.get("ProspectStage")),
            "lsq_lead_stage": _display(lead.get("mx_Main_Lead_Stages")),
            "lsq_created_on": created_on,
            "lsq_modified_on": _display(lead.get("ModifiedOn")),
            "channel": channel,
            "is_clash": verdict.is_clash,
            "clash_at_block": verdict.clash_at_block,
            "clash_at_admission": verdict.clash_at_admission,
            "synced_at": synced_at,
        }

    def _records_to_frame(self, records: List[Dict[str, Any]]) -> pl.DataFrame:
        if not records:
            empty = {col: [] for col in ADMISSION_JOURNEY_COLUMNS}
            frame = pl.DataFrame(empty)
        else:
            frame = pl.DataFrame(records, infer_schema_length=None)
        exprs = []
        for col in ADMISSION_JOURNEY_COLUMNS:
            if col not in frame.columns:
                if col in ADMISSION_JOURNEY_BOOLEAN_COLUMNS:
                    exprs.append(pl.lit(False).alias(col))
                else:
                    exprs.append(pl.lit(None).cast(pl.Utf8).alias(col))
            elif col in ADMISSION_JOURNEY_BOOLEAN_COLUMNS:
                exprs.append(pl.col(col).cast(pl.Boolean).alias(col))
            else:
                exprs.append(pl.col(col).cast(pl.Utf8).alias(col))
        return frame.select(exprs)

    def _write_frame(
        self,
        frame: pl.DataFrame,
        synced_at: str,
        unmatched_lsq: int,
        failed: int,
    ) -> Dict[str, Any]:
        tmp_path = self.parquet_path.with_suffix(".tmp.parquet")
        frame.write_parquet(tmp_path)
        tmp_path.replace(self.parquet_path)
        clash_count = int(frame["is_clash"].sum()) if frame.height else 0
        clash_at_block = int(frame["clash_at_block"].sum()) if frame.height else 0
        clash_at_admission = int(frame["clash_at_admission"].sum()) if frame.height else 0
        paid_count = int(frame["sheet_is_paid"].sum()) if frame.height else 0
        dp_count = int((frame["channel"] == CHANNEL_DIGITAL_PARTNER).sum()) if frame.height else 0
        counsellor_count = (
            int((frame["channel"] == CHANNEL_COUNSELLOR).sum()) if frame.height else 0
        )
        other_count = int((frame["channel"] == CHANNEL_OTHER).sum()) if frame.height else 0
        campuses = sorted(
            {
                str(v).strip()
                for v in (frame["campus_code"].drop_nulls().to_list() if frame.height else [])
                if str(v).strip()
            }
        )
        meta = {
            "synced_at": synced_at,
            "row_count": frame.height,
            "unmatched_lsq": unmatched_lsq,
            "failed": failed,
            "clash_count": clash_count,
            "clash_at_block": clash_at_block,
            "clash_at_admission": clash_at_admission,
            "paid_count": paid_count,
            "dp_count": dp_count,
            "counsellor_count": counsellor_count,
            "other_count": other_count,
            "campuses": campuses,
        }
        self.meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        self.duck_repo.invalidate_metadata_cache()
        logger.info(
            "admission_journey_written",
            rows=frame.height,
            unmatched_lsq=unmatched_lsq,
        )
        return meta

    def _students_where(
        self,
        *,
        campus: Optional[str] = None,
        clash: Optional[str] = None,
        paid: Optional[str] = None,
        channel: Optional[str] = None,
        block_status: Optional[str] = None,
        search: Optional[str] = None,
    ) -> Tuple[str, List[Any]]:
        where = ["1=1"]
        params: List[Any] = []
        if campus:
            where.append(
                "LOWER(COALESCE(campus_code, college_code, '')) LIKE ?"
            )
            params.append(f"%{campus.strip().lower()}%")
        if clash in {"true", "1", "yes", "any"}:
            where.append("is_clash")
        elif clash in {"block", "clash_at_block"}:
            where.append("clash_at_block")
        elif clash in {"admission", "clash_at_admission"}:
            where.append("clash_at_admission")
        elif clash in {"false", "0", "no"}:
            where.append("NOT COALESCE(is_clash, FALSE)")
        if paid in {"true", "1", "yes"}:
            where.append("sheet_is_paid")
        elif paid in {"false", "0", "no"}:
            where.append("NOT COALESCE(sheet_is_paid, FALSE)")
        if channel and channel != "all":
            where.append("channel = ?")
            params.append(channel)
        block_kind = (block_status or "").strip().lower()
        if block_kind in {"full", "full_payment", "partial", "partial_payment"}:
            where.append(_block_status_filter_sql(block_kind))
        if search and search.strip():
            q = f"%{search.strip().lower()}%"
            where.append(
                "("
                "LOWER(COALESCE(student_name, '')) LIKE ? OR "
                "LOWER(COALESCE(email, '')) LIKE ? OR "
                "COALESCE(phone, '') LIKE ?"
                ")"
            )
            params.extend([q, q, f"%{search.strip()}%"])
        return " AND ".join(where), params

    def list_students(
        self,
        *,
        campus: Optional[str] = None,
        clash: Optional[str] = None,
        paid: Optional[str] = None,
        channel: Optional[str] = None,
        block_status: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> Dict[str, Any]:
        if not self.duck_repo.admission_journey_exists():
            return {
                "items": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
                "total_pages": 0,
            }

        clause, params = self._students_where(
            campus=campus,
            clash=clash,
            paid=paid,
            channel=channel,
            block_status=block_status,
            search=search,
        )
        total_row = self.duck_repo.query_dicts(
            f"SELECT COUNT(*) AS cnt FROM {ADMISSION_JOURNEY_TABLE} WHERE {clause}",
            params,
        )
        total = int(total_row[0]["cnt"]) if total_row else 0
        offset = max(page - 1, 0) * page_size
        items = self.duck_repo.query_dicts(
            f"""
            SELECT
              journey_id,
              student_name,
              email,
              phone,
              campus_code,
              college_code,
              college_name,
              sheet_status,
              sheet_is_paid,
              amount_inr,
              block_amount_paid_sheet,
              block_payment_status,
              lsq_prospect_stage,
              lsq_lead_stage,
              lsq_source,
              lsq_created_on,
              lsq_modified_on,
              original_utm_medium,
              original_utm_campaign,
              contact_source_sheet,
              source_at_payment,
              campaign_at_payment,
              lms_status,
              channel,
              is_clash,
              clash_at_block,
              clash_at_admission,
              lsq_matched
            FROM {ADMISSION_JOURNEY_TABLE}
            WHERE {clause}
            ORDER BY student_name NULLS LAST, email NULLS LAST
            LIMIT ? OFFSET ?
            """,
            params + [page_size, offset],
        )
        refund_email, refund_phone = self._refund_index()
        for item in items:
            item["is_clash"] = _as_bool(item.get("is_clash"))
            item["clash_at_block"] = _as_bool(item.get("clash_at_block"))
            item["clash_at_admission"] = _as_bool(item.get("clash_at_admission"))
            item["sheet_is_paid"] = _as_bool(item.get("sheet_is_paid"))
            item["lsq_matched"] = _as_bool(item.get("lsq_matched"))
            campus_label = _join_nonempty(
                item.get("campus_code") or item.get("college_code"),
                item.get("college_name"),
            )
            item["campus"] = campus_label
            item["lsq_stage_label"] = format_lsq_stages(
                item.get("lsq_lead_stage"), item.get("lsq_prospect_stage")
            )
            refund = _match_side(item, refund_email, refund_phone)
            item.update(journey_status_flags(item, refund))
            item["block_payment_status"] = resolve_block_payment_status(
                item.get("block_payment_status"),
                item.get("block_amount_paid_sheet"),
            )
        total_pages = (total + page_size - 1) // page_size if page_size else 0
        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    EXPORT_ROW_LIMIT = 20_000

    def export_students_csv(
        self,
        *,
        campus: Optional[str] = None,
        clash: Optional[str] = None,
        paid: Optional[str] = None,
        channel: Optional[str] = None,
        block_status: Optional[str] = None,
        search: Optional[str] = None,
    ) -> str:
        if not self.duck_repo.admission_journey_exists():
            return self._rows_to_csv([])

        clause, params = self._students_where(
            campus=campus,
            clash=clash,
            paid=paid,
            channel=channel,
            block_status=block_status,
            search=search,
        )
        total_row = self.duck_repo.query_dicts(
            f"SELECT COUNT(*) AS cnt FROM {ADMISSION_JOURNEY_TABLE} WHERE {clause}",
            params,
        )
        total = int(total_row[0]["cnt"]) if total_row else 0
        if total > self.EXPORT_ROW_LIMIT:
            raise ValueError(
                f"Export limited to {self.EXPORT_ROW_LIMIT:,} students "
                f"({total:,} match). Narrow filters and try again."
            )

        rows = self.duck_repo.query_dicts(
            f"""
            SELECT *
            FROM {ADMISSION_JOURNEY_TABLE}
            WHERE {clause}
            ORDER BY student_name NULLS LAST, email NULLS LAST
            """,
            params,
        )
        refund_email, refund_phone = self._refund_index()
        out_rows: List[Dict[str, Any]] = []
        for row in rows:
            payload = self._detail_payload(row)
            refund = _match_side(row, refund_email, refund_phone)
            flags = journey_status_flags(
                {**row, "block_amount": row.get("block_amount_paid_sheet")},
                refund,
            )
            payload["header"].update(flags)
            payload["header"]["lsq_stage_label"] = format_lsq_stages(
                row.get("lsq_lead_stage"), row.get("lsq_prospect_stage")
            )
            if refund:
                payload["header"]["refund_status"] = _display(
                    refund.get("final_status") or refund.get("status_finance")
                )
            out_rows.append(self._flatten_detail_for_export(payload))
        return self._rows_to_csv(out_rows)

    def _flatten_detail_for_export(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        header = payload.get("header") or {}
        flat: Dict[str, Any] = {
            "journey_id": header.get("journey_id"),
            "name": header.get("name"),
            "email": header.get("email"),
            "phone": header.get("phone"),
            "campus": header.get("campus"),
            "campus_code": header.get("campus_code"),
            "college_code": header.get("college_code"),
            "college_name": header.get("college_name"),
            "channel": header.get("channel"),
            "lsq_matched": not header.get("unmatched_lsq"),
            "unmatched_lsq": header.get("unmatched_lsq"),
            "clash": header.get("clash"),
            "clash_at_block": header.get("clash_at_block"),
            "clash_at_admission": header.get("clash_at_admission"),
            "clash_note": header.get("clash_note"),
            "clash_with": header.get("clash_with"),
            "sheet_paid": header.get("sheet_paid"),
            "sheet_status": header.get("sheet_status"),
            "amount_inr": header.get("amount_inr"),
            "sem_utr": header.get("sem_utr"),
            "paid_at": header.get("paid_at"),
            "dop": header.get("dop"),
            "block_amount": header.get("block_amount"),
            "block_payment_status": header.get("block_payment_status"),
            "block_utr": header.get("block_utr"),
            "block_payment_done": header.get("block_payment_done"),
            "source_at_payment": header.get("source_at_payment"),
            "campaign_at_payment": header.get("campaign_at_payment"),
            "lms_status": header.get("lms_status"),
            "lms_payable_inr": header.get("lms_payable_inr"),
            "lms_verified_paid_inr": header.get("lms_verified_paid_inr"),
            "lms_utr": header.get("lms_utr"),
            "lms_submitted_on": header.get("lms_submitted_on"),
            "lms_verified_on": header.get("lms_verified_on"),
            "lms_paid_on": header.get("lms_paid_on"),
            "sem_fee_under_review": header.get("sem_fee_under_review"),
            "sem_fee_verified": header.get("sem_fee_verified"),
            "refund_case": header.get("refund_case"),
            "refund_status": header.get("refund_status"),
            "lsq_prospect_id": header.get("lsq_prospect_id"),
            "lsq_created_on": header.get("lsq_created_on"),
            "lsq_modified_on": header.get("lsq_modified_on"),
            "lsq_source": header.get("lsq_source"),
            "lsq_medium": header.get("lsq_medium"),
            "lsq_campaign": header.get("lsq_campaign"),
            "lsq_prospect_stage": header.get("lsq_prospect_stage"),
            "lsq_lead_stage": header.get("lsq_lead_stage"),
            "lsq_stage_label": header.get("lsq_stage_label"),
            "contact_source_sheet": header.get("contact_source_sheet"),
            "original_utm_medium": header.get("original_utm_medium"),
            "original_utm_campaign": header.get("original_utm_campaign"),
            "sheet_created_at": header.get("sheet_created_at"),
            "sheet_updated_at": header.get("sheet_updated_at"),
        }

        for step in payload.get("path") or []:
            key = step.get("key") or "step"
            flat[f"step_{key}_lsq"] = step.get("lsq")
            flat[f"step_{key}_sheet"] = step.get("sheet")
            flat[f"step_{key}_date"] = step.get("date")
            flat[f"step_{key}_mismatch"] = step.get("mismatch")
            flat[f"step_{key}_empty"] = step.get("empty")
            field_parts: List[str] = []
            for field in step.get("fields") or []:
                label = field.get("label") or ""
                lsq_val = field.get("lsq")
                sheet_val = field.get("sheet")
                if lsq_val and sheet_val:
                    field_parts.append(f"{label}: LSQ={lsq_val}; Sheet={sheet_val}")
                elif lsq_val:
                    field_parts.append(f"{label}: {lsq_val}")
                elif sheet_val:
                    field_parts.append(f"{label}: {sheet_val}")
            flat[f"step_{key}_fields"] = " | ".join(field_parts) if field_parts else None

        for chip in payload.get("stages") or []:
            key = chip.get("key") or "stage"
            flat[f"stage_{key}_reached"] = chip.get("reached")
            flat[f"stage_{key}_at"] = chip.get("at")
            flat[f"stage_{key}_detail"] = chip.get("detail")

        events = payload.get("events") or []
        flat["events"] = " | ".join(
            f"{ev.get('label')} @ {ev.get('at')}"
            for ev in events
            if ev.get("label") and ev.get("at")
        ) or None
        return flat

    @staticmethod
    def _rows_to_csv(rows: List[Dict[str, Any]]) -> str:
        output = io.StringIO()
        fieldnames = list(EXPORT_CSV_COLUMNS)
        if rows:
            # Preserve stable order; append any unexpected keys at the end.
            extra = [k for k in rows[0].keys() if k not in fieldnames]
            fieldnames = fieldnames + extra
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {k: "" if row.get(k) is None else row.get(k) for k in fieldnames}
            )
        return output.getvalue()

    def get_student(self, journey_id: str) -> Optional[Dict[str, Any]]:
        if not self.duck_repo.admission_journey_exists():
            return None
        rows = self.duck_repo.query_dicts(
            f"SELECT * FROM {ADMISSION_JOURNEY_TABLE} WHERE journey_id = ? LIMIT 1",
            [journey_id],
        )
        if not rows:
            return None
        payload = self._detail_payload(rows[0])
        refund_email, refund_phone = self._refund_index()
        refund = _match_side(rows[0], refund_email, refund_phone)
        flags = journey_status_flags(
            {**rows[0], "block_amount": rows[0].get("block_amount_paid_sheet")},
            refund,
        )
        payload["header"].update(flags)
        payload["header"]["lsq_stage_label"] = format_lsq_stages(
            rows[0].get("lsq_lead_stage"), rows[0].get("lsq_prospect_stage")
        )
        if refund:
            payload["header"]["refund_status"] = _display(
                refund.get("final_status") or refund.get("status_finance")
            )
        return payload

    def _refund_index(self) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
        if not self.duck_repo.refund_exists():
            return {}, {}
        try:
            rows = self.duck_repo.query_dicts(f"SELECT * FROM {REFUND_TABLE}")
        except Exception:
            return {}, {}
        return _index_by_email_phone(rows)

    def _detail_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
        lsq_matched = _as_bool(row.get("lsq_matched"))
        clash = _as_bool(row.get("is_clash"))
        clash_at_block = _as_bool(row.get("clash_at_block"))
        clash_at_admission = _as_bool(row.get("clash_at_admission"))
        sheet_paid = _as_bool(row.get("sheet_is_paid"))
        lms_status = _display(row.get("lms_status"))
        campus = _join_nonempty(
            row.get("campus_code") or row.get("college_code"),
            row.get("college_name"),
        )
        header = {
            "journey_id": row.get("journey_id"),
            "name": _display(row.get("student_name")),
            "email": _display(row.get("email")),
            "phone": _display(row.get("phone")),
            "campus": campus,
            "campus_code": _display(row.get("campus_code")),
            "college_code": _display(row.get("college_code")),
            "college_name": _display(row.get("college_name")),
            "sheet_paid": sheet_paid,
            "sheet_status": _display(row.get("sheet_status")),
            "lms_status": lms_status,
            "channel": row.get("channel") or CHANNEL_OTHER,
            "clash": clash,
            "clash_at_block": clash_at_block,
            "clash_at_admission": clash_at_admission,
            "clash_note": _clash_note(clash, clash_at_block, clash_at_admission),
            "clash_with": format_clash_at_with(
                clash=clash,
                clash_at_block=clash_at_block,
                clash_at_admission=clash_at_admission,
                lsq_source=row.get("lsq_source"),
                contact_source_sheet=row.get("contact_source_sheet"),
                original_utm_campaign=row.get("original_utm_campaign"),
                original_utm_medium=row.get("original_utm_medium"),
                lsq_campaign=row.get("lsq_campaign"),
                source_at_payment=row.get("source_at_payment"),
                campaign_at_payment=row.get("campaign_at_payment"),
                lsq_prospect_stage=row.get("lsq_prospect_stage"),
                lsq_lead_stage=row.get("lsq_lead_stage"),
            ),
            "unmatched_lsq": not lsq_matched,
            "lsq_prospect_id": _display(row.get("lsq_prospect_id")),
            "lsq_created_on": _display(row.get("lsq_created_on")),
            "lsq_modified_on": _display(row.get("lsq_modified_on")),
            "lsq_source": _display(row.get("lsq_source")),
            "lsq_medium": _display(row.get("lsq_medium")),
            "lsq_campaign": _display(row.get("lsq_campaign")),
            "lsq_prospect_stage": _display(row.get("lsq_prospect_stage")),
            "lsq_lead_stage": _display(row.get("lsq_lead_stage")),
            "lsq_stage_label": format_lsq_stages(
                row.get("lsq_lead_stage"), row.get("lsq_prospect_stage")
            ),
            "contact_source_sheet": _display(row.get("contact_source_sheet")),
            "original_utm_medium": _display(row.get("original_utm_medium")),
            "original_utm_campaign": _display(row.get("original_utm_campaign")),
            "source_at_payment": _display(row.get("source_at_payment")),
            "campaign_at_payment": _display(row.get("campaign_at_payment")),
            "amount_inr": _display(row.get("amount_inr")),
            "block_amount": _display(row.get("block_amount_paid_sheet")),
            "block_payment_status": resolve_block_payment_status(
                row.get("block_payment_status"),
                row.get("block_amount_paid_sheet"),
            ),
            "lms_verified_paid_inr": _display(row.get("lms_verified_paid_inr")),
            "lms_payable_inr": _display(row.get("lms_payable_inr")),
            "paid_at": _display(row.get("paid_at")),
            "dop": _display(row.get("dop")),
            "lms_verified_on": _display(row.get("lms_verified_on")),
            "lms_paid_on": _display(row.get("lms_paid_on")),
            "lms_submitted_on": _display(row.get("lms_submitted_on")),
            "lms_utr": _display(row.get("lms_utr")),
            "sem_utr": _display(row.get("sem_utr")),
            "block_utr": _display(row.get("block_utr")),
            "sheet_status": _display(row.get("sheet_status")),
            "sheet_created_at": _display(row.get("sheet_created_at")),
            "sheet_updated_at": _display(row.get("sheet_updated_at")),
        }
        return {
            "header": header,
            "path": self._path_steps(row),
            "stages": self._stage_chips(row, sheet_paid, lms_status),
            "events": build_journey_events(row),
        }

    def _path_steps(self, row: Dict[str, Any]) -> List[Dict[str, Any]]:
        created_lsq = _display(row.get("lsq_created_on"))
        contact_lsq = _display(row.get("lsq_source"))
        contact_sheet = _display(row.get("contact_source_sheet"))
        orig_lsq = _join_nonempty(row.get("lsq_medium"), row.get("lsq_campaign"))
        orig_sheet = _join_nonempty(
            row.get("original_utm_medium"), row.get("original_utm_campaign")
        )
        stage_lsq = format_lsq_stages(
            row.get("lsq_lead_stage"), row.get("lsq_prospect_stage")
        )
        payment_sheet = _join_nonempty(
            row.get("source_at_payment"), row.get("campaign_at_payment")
        )
        block_status = resolve_block_payment_status(
            row.get("block_payment_status"),
            row.get("block_amount_paid_sheet"),
        )
        amounts_sheet = _join_nonempty(
            f"Semester {_blank(row.get('amount_inr'))}".strip()
            if _blank(row.get("amount_inr"))
            else None,
            f"Block {_blank(row.get('block_amount_paid_sheet'))}".strip()
            if _blank(row.get("block_amount_paid_sheet"))
            else None,
            f"LMS verified {_blank(row.get('lms_verified_paid_inr'))}".strip()
            if _blank(row.get("lms_verified_paid_inr"))
            else None,
        )
        campus_sheet = _join_nonempty(
            row.get("campus_code"),
            row.get("college_code"),
            row.get("college_name"),
        )
        campus_lms = _display(row.get("lms_campus"))
        created_sheet = _display(row.get("sheet_created_at"))
        modified_lsq = _display(row.get("lsq_modified_on"))
        paid_at = _display(row.get("paid_at") or row.get("dop"))
        lms_at = _display(
            row.get("lms_verified_on") or row.get("lms_paid_on") or row.get("lms_submitted_on")
        )
        by_key: Dict[str, Dict[str, Any]] = {
            "created": {
                "lsq": created_lsq,
                "sheet": created_sheet,
                "date": created_lsq or created_sheet,
                "fields": [
                    _compare_field("Created on", lsq=created_lsq),
                    _compare_field("Modified on", lsq=row.get("lsq_modified_on")),
                    _compare_field("Sheet created at", sheet=row.get("sheet_created_at")),
                    _compare_field("Sheet updated at", sheet=row.get("sheet_updated_at")),
                    _compare_field("Prospect ID", lsq=row.get("lsq_prospect_id")),
                ],
            },
            "contact_source": {
                "lsq": contact_lsq,
                "sheet": contact_sheet,
                "date": created_lsq or created_sheet,
                "fields": [
                    _compare_field("Contact source", lsq=contact_lsq, sheet=contact_sheet),
                ],
            },
            "original_utm": {
                "lsq": orig_lsq,
                "sheet": orig_sheet,
                "date": created_lsq or created_sheet,
                "fields": [
                    _compare_field(
                        "Medium",
                        lsq=row.get("lsq_medium"),
                        sheet=row.get("original_utm_medium"),
                    ),
                    _compare_field(
                        "Campaign",
                        lsq=row.get("lsq_campaign"),
                        sheet=row.get("original_utm_campaign"),
                    ),
                ],
            },
            "utm_activity": {
                "lsq": None,
                "sheet": _display(row.get("utm_activity")),
                "date": modified_lsq or _display(row.get("sheet_updated_at")),
                "fields": [
                    _compare_field("UTM activity", sheet=row.get("utm_activity")),
                    _compare_field("Last LSQ activity", lsq=row.get("lsq_modified_on")),
                ],
            },
            "lsq_stage": {
                "lsq": stage_lsq,
                "sheet": _join_nonempty(row.get("lms_status"), row.get("sheet_status")),
                "date": modified_lsq or created_lsq,
                "fields": [
                    _compare_field("Main lead stage", lsq=row.get("lsq_lead_stage")),
                    _compare_field("Prospect stage", lsq=row.get("lsq_prospect_stage")),
                    _compare_field("Last LSQ activity", lsq=row.get("lsq_modified_on")),
                    _compare_field("Sheet payment status", sheet=row.get("sheet_status")),
                    _compare_field("LMS fee status", sheet=row.get("lms_status")),
                ],
            },
            "payment_source": {
                "lsq": None,
                "sheet": payment_sheet,
                "date": paid_at,
                "fields": [
                    _compare_field("Test payment source", sheet=row.get("source_at_payment")),
                    _compare_field(
                        "Campaign at payment", sheet=row.get("campaign_at_payment")
                    ),
                    _compare_field(
                        "Block payment status", sheet=block_status
                    ),
                    _compare_field("Block UTR", sheet=row.get("block_utr")),
                    _compare_field("Paid at", sheet=row.get("paid_at")),
                ],
            },
            "amounts": {
                "lsq": None,
                "sheet": amounts_sheet,
                "date": paid_at or lms_at,
                "fields": [
                    _compare_field("Semester amount", sheet=row.get("amount_inr")),
                    _compare_field(
                        "Semester payment status", sheet=row.get("sheet_status")
                    ),
                    _compare_field("Paid at", sheet=row.get("paid_at")),
                    _compare_field("DOP", sheet=row.get("dop")),
                    _compare_field("Semester UTR", sheet=row.get("sem_utr")),
                    _compare_field(
                        "Block amount (sheet)", sheet=row.get("block_amount_paid_sheet")
                    ),
                    _compare_field(
                        "Block payment status", sheet=block_status
                    ),
                    _compare_field("Block UTR", sheet=row.get("block_utr")),
                    _compare_field("LMS payable", sheet=row.get("lms_payable_inr")),
                    _compare_field(
                        "LMS verified paid", sheet=row.get("lms_verified_paid_inr")
                    ),
                    _compare_field("LMS UTR", sheet=row.get("lms_utr")),
                    _compare_field("LMS submitted on", sheet=row.get("lms_submitted_on")),
                    _compare_field("LMS verified on", sheet=row.get("lms_verified_on")),
                    _compare_field("LMS paid on", sheet=row.get("lms_paid_on")),
                ],
            },
            "recent_utm": {
                "lsq": None,
                "sheet": _display(row.get("recent_utm")),
                "date": modified_lsq,
                "fields": [
                    _compare_field("Recent UTM", sheet=row.get("recent_utm")),
                    _compare_field("Last LSQ activity", lsq=row.get("lsq_modified_on")),
                ],
            },
            "campus": {
                "lsq": campus_lms,
                "sheet": campus_sheet,
                "date": lms_at or paid_at or _display(row.get("sheet_updated_at")),
                "fields": [
                    _compare_field(
                        "Campus code",
                        lsq=row.get("lms_campus"),
                        sheet=row.get("campus_code"),
                    ),
                    _compare_field("College code", sheet=row.get("college_code")),
                    _compare_field("College name", sheet=row.get("college_name")),
                    _compare_field("LMS campus", sheet=row.get("lms_campus")),
                    _compare_field("LMS semester", sheet=row.get("lms_semester")),
                    _compare_field("LMS submitted on", sheet=row.get("lms_submitted_on")),
                    _compare_field("LMS verified on", sheet=row.get("lms_verified_on")),
                ],
            },
        }
        steps = []
        for key, label in PATH_STEPS:
            spec = by_key[key]
            lsq_val = spec.get("lsq")
            sheet_val = spec.get("sheet")
            fields = spec.get("fields") or []
            steps.append(
                {
                    "key": key,
                    "label": label,
                    "lsq": lsq_val,
                    "sheet": sheet_val,
                    "date": spec.get("date"),
                    "mismatch": any(f.get("mismatch") for f in fields)
                    or _mismatch(lsq_val, sheet_val),
                    "empty": not any(not f.get("empty") for f in fields)
                    and not (lsq_val or sheet_val),
                    "fields": fields,
                }
            )
        return steps

    def _stage_chips(
        self,
        row: Dict[str, Any],
        sheet_paid: bool,
        lms_status: Optional[str],
    ) -> List[Dict[str, Any]]:
        rank = _funnel_rank(row)
        created_at = _display(row.get("lsq_created_on") or row.get("sheet_created_at"))
        modified_at = _display(row.get("lsq_modified_on"))
        paid_at = _display(row.get("paid_at") or row.get("dop"))
        lms_at = _display(
            row.get("lms_verified_on") or row.get("lms_paid_on") or row.get("lms_submitted_on")
        )
        prospect = _display(row.get("lsq_prospect_stage"))
        lead_stage = _display(row.get("lsq_lead_stage"))
        block_paid = bool(
            rank >= stage_rank("Block Amount Paid")
            or _blank(row.get("block_payment_status")).lower()
            in {
                "paid",
                "success",
                "completed",
                "full payment",
                "partial payment",
                "partly paid",
            }
            or "full payment" in _blank(row.get("block_payment_status")).lower()
            or "partial" in _blank(row.get("block_payment_status")).lower()
            or _blank(row.get("block_amount_paid_sheet"))
        )
        lms_verified = (lms_status or "").strip().lower() == "verified"
        sem_reached = sheet_paid or lms_verified
        reached = {
            "created": bool(created_at or rank >= 1),
            "pipeline": rank >= stage_rank("Connected"),
            "offer": rank >= stage_rank("Offer Letter"),
            "block": block_paid,
            "sem": sem_reached,
        }
        at = {
            "created": created_at,
            "pipeline": modified_at or created_at,
            "offer": modified_at if reached["offer"] else None,
            "block": paid_at if block_paid else None,
            "sem": (lms_at or paid_at) if sem_reached else None,
        }
        details = {
            "created": created_at or "Lead present on All Payments",
            "pipeline": _join_nonempty(prospect, lead_stage) or "Not reached in LSQ",
            "offer": lead_stage or prospect or "Offer letter not reached",
            "block": _join_nonempty(
                row.get("block_payment_status"),
                row.get("source_at_payment"),
                row.get("block_amount_paid_sheet"),
            )
            or "No block payment on sheet",
            "sem": _join_nonempty(
                f"Sheet {row.get('sheet_status')}" if row.get("sheet_status") else None,
                f"LMS {lms_status}" if lms_status else None,
                f"Paid {paid_at}" if paid_at else None,
            )
            or "Semester fee not recorded",
        }
        return [
            {
                "key": key,
                "label": label,
                "reached": reached[key],
                "at": at[key],
                "detail": details[key],
            }
            for key, label in STAGE_CHIPS
        ]
