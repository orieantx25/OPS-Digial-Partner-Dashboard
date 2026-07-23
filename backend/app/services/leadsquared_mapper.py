"""Map LeadSquared API payloads to dashboard canonical columns."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import polars as pl

from app.domain.schema import OPTIONAL_COLUMNS, REQUIRED_COLUMNS
from app.logging_config import get_logger

logger = get_logger(__name__)

_FIELD_MAP_PATH = Path(__file__).resolve().parents[2] / "config" / "leadsquared_field_map.json"


def _load_field_map() -> Dict[str, Any]:
    with open(_FIELD_MAP_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def lead_include_csv(extra_fields: Optional[List[str]] = None) -> str:
    cfg = _load_field_map()
    fields = list(cfg.get("include_lead_csv_defaults") or [])
    lead_map = cfg.get("lead_fields") or {}
    fields.extend(lead_map.keys())
    if extra_fields:
        fields.extend(extra_fields)
    seen: set[str] = set()
    ordered: List[str] = []
    for name in fields:
        if name and name not in seen and not name.startswith("_"):
            seen.add(name)
            ordered.append(name)
    return ",".join(ordered)


def _combine_name(row: Dict[str, Any]) -> Optional[str]:
    first = str(row.get("name") or row.get("FirstName") or "").strip()
    last = str(row.get("_last_name") or row.get("LastName") or "").strip()
    if first and last:
        return f"{first} {last}".strip()
    return first or last or None


def _first_nonempty(*values: Any) -> Optional[Any]:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _safe_frame_from_rows(rows: List[Dict[str, Any]]) -> pl.DataFrame:
    """Build a DataFrame without failing on mixed-type columns.

    LeadSquared (and some uploads) often put numbers in early rows and strings
    later (e.g. a name like \"MOYLI P R\"). Inferring from only the first N rows
    then crashes; scan all rows, and fall back to Utf8 coercion if needed.
    """
    if not rows:
        return pl.DataFrame()

    try:
        # None => inspect every row before choosing dtypes.
        return pl.DataFrame(rows, infer_schema_length=None)
    except Exception as exc:
        logger.warning("polars_infer_failed_coerce_utf8", error=str(exc))

    keys: List[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                keys.append(key)

    def _as_utf8(value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(value)

    cols = {key: [_as_utf8(row.get(key)) for row in rows] for key in keys}
    return pl.DataFrame(cols)


def map_leads_to_dataframe(leads: List[Dict[str, Any]]) -> pl.DataFrame:
    """Convert LSQ lead attribute dicts into a Polars frame with canonical columns.

    CRM "Contact Stage" is ProspectStage (not mx_Contact_Stage, which is often
    empty). CRM "Main Lead Stages" is mx_Main_Lead_Stages.
    """
    if not leads:
        return pl.DataFrame()

    cfg = _load_field_map()
    lead_fields: Dict[str, str] = cfg.get("lead_fields") or {}
    canonical_cols = set(REQUIRED_COLUMNS + OPTIONAL_COLUMNS)

    rows: List[Dict[str, Any]] = []
    for raw in leads:
        mapped: Dict[str, Any] = {}
        for lsq_key, value in raw.items():
            canon = lead_fields.get(lsq_key)
            if not canon:
                continue
            if canon.startswith("_"):
                mapped[canon] = value
            elif canon in canonical_cols:
                # Do not let a later null overwrite an earlier non-empty value.
                if value is None or (isinstance(value, str) and not value.strip()):
                    continue
                if canon in mapped and mapped[canon] not in (None, ""):
                    continue
                mapped[canon] = value

        # Explicit CRM column mapping (priority over dict iteration order).
        contact = _first_nonempty(
            raw.get("ProspectStage"),
            raw.get("mx_Contact_Stage"),
            raw.get("mx_Contact_Stage_"),
            mapped.get("contact_stage"),
        )
        if contact is not None:
            mapped["contact_stage"] = contact

        lead = _first_nonempty(
            raw.get("mx_Main_Lead_Stages"),
            raw.get("mx_Main_Lead_Stage"),
            mapped.get("lead_stage"),
        )
        if lead is not None:
            mapped["lead_stage"] = lead

        name = _combine_name({**raw, **mapped})
        if name:
            mapped["name"] = name
        rows.append(mapped)

    if not rows:
        return pl.DataFrame()

    df = _safe_frame_from_rows(rows)
    drop_cols = [c for c in df.columns if c.startswith("_")]
    if drop_cols:
        df = df.drop(drop_cols)
    return df


def map_activities_to_dataframe(activities: List[Dict[str, Any]]) -> pl.DataFrame:
    if not activities:
        return pl.DataFrame()

    cfg = _load_field_map()
    activity_fields: Dict[str, str] = cfg.get("activity_fields") or {}

    rows: List[Dict[str, Any]] = []
    for act in activities:
        mapped: Dict[str, Any] = {}
        for src, canon in activity_fields.items():
            if src in act and act[src] is not None:
                mapped[canon] = act[src]
        for field in act.get("Fields") or []:
            key = field.get("Key") or field.get("SchemaName")
            val = field.get("Value")
            if key and key in activity_fields:
                mapped[activity_fields[key]] = val
        if act.get("ProspectId") and "prospect_id" not in mapped:
            mapped["prospect_id"] = act["ProspectId"]
        if act.get("RelatedProspectId") and "prospect_id" not in mapped:
            mapped["prospect_id"] = act["RelatedProspectId"]
        if act.get("EventName") and "notes" not in mapped:
            mapped["notes"] = act["EventName"]
        if act.get("CreatedOn") and "activity_date" not in mapped:
            mapped["activity_date"] = act["CreatedOn"]
        if act.get("Id") and "activity_id" not in mapped:
            mapped["activity_id"] = act["Id"]
        rows.append(mapped)

    return _safe_frame_from_rows(rows)
