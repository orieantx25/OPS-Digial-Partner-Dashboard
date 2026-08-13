"""Admissions sheets — All Payments list + LMS fee status (manual upload / Google sync)."""

import io
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import polars as pl

from app.config import Settings, get_settings
from app.domain.schema import (
    ADMISSIONS_COLUMN_ALIASES,
    ADMISSIONS_COLUMNS,
    ADMISSIONS_LMS_COLUMN_ALIASES,
    ADMISSIONS_LMS_COLUMNS,
    ADMISSIONS_LMS_META_FILE,
    ADMISSIONS_LMS_PARQUET_FILE,
    ADMISSIONS_META_FILE,
    ADMISSIONS_PARQUET_FILE,
)
from app.infrastructure.duckdb_repo import DuckDBRepository
from app.logging_config import get_logger
from app.services.block_payment_service import normalize_match_email
from app.services.ingestion_service import normalize_phone

logger = get_logger(__name__)


def _clean_header(header: str) -> str:
    return re.sub(r"\s+", " ", str(header).replace("\n", " ").strip().lower())


def normalize_admissions_header(header: str) -> str:
    cleaned = _clean_header(header)
    if cleaned in ADMISSIONS_COLUMN_ALIASES:
        return ADMISSIONS_COLUMN_ALIASES[cleaned]
    compact = cleaned.replace(" ", "")
    if compact in ADMISSIONS_COLUMN_ALIASES:
        return ADMISSIONS_COLUMN_ALIASES[compact]
    return cleaned.replace(" ", "_")


def normalize_lms_header(header: str) -> str:
    cleaned = _clean_header(header)
    if cleaned in ADMISSIONS_LMS_COLUMN_ALIASES:
        return ADMISSIONS_LMS_COLUMN_ALIASES[cleaned]
    compact = cleaned.replace(" ", "")
    if compact in ADMISSIONS_LMS_COLUMN_ALIASES:
        return ADMISSIONS_LMS_COLUMN_ALIASES[compact]
    return cleaned.replace(" ", "_")


def is_paid_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if not text:
        return False
    # Fee Verification "All Payments" uses Full/Partial Payment (not bare "Paid").
    if text in {
        "true",
        "1",
        "yes",
        "y",
        "t",
        "paid",
        "verified",
        "full payment",
        "partial payment",
        "partly paid",
        "complete",
        "completed",
    }:
        return True
    return "paid" in text or "verified" in text or "full payment" in text


def apply_admissions_mapping(df: pl.DataFrame) -> pl.DataFrame:
    groups: Dict[str, List[str]] = {}
    for col in df.columns:
        canon = normalize_admissions_header(col)
        groups.setdefault(canon, []).append(col)

    exprs = []
    for canon, raws in groups.items():
        if len(raws) == 1:
            exprs.append(pl.col(raws[0]).cast(pl.Utf8).alias(canon))
        else:
            exprs.append(
                pl.coalesce([pl.col(r).cast(pl.Utf8) for r in raws]).alias(canon)
            )
    return df.select(exprs)


def apply_lms_mapping(df: pl.DataFrame) -> pl.DataFrame:
    groups: Dict[str, List[str]] = {}
    for col in df.columns:
        canon = normalize_lms_header(col)
        groups.setdefault(canon, []).append(col)

    exprs = []
    for canon, raws in groups.items():
        if len(raws) == 1:
            exprs.append(pl.col(raws[0]).cast(pl.Utf8).alias(canon))
        else:
            exprs.append(
                pl.coalesce([pl.col(r).cast(pl.Utf8) for r in raws]).alias(canon)
            )
    return df.select(exprs)


class AdmissionsService:
    """Persist All Payments admissions + LMS fee verification sheets."""

    def __init__(
        self,
        duck_repo: Optional[DuckDBRepository] = None,
        settings: Optional[Settings] = None,
    ):
        self.settings = settings or get_settings()
        self.duck_repo = duck_repo or DuckDBRepository(self.settings)
        self.parquet_path = self.settings.parquet_dir / ADMISSIONS_PARQUET_FILE
        self.meta_path = self.settings.parquet_dir / ADMISSIONS_META_FILE
        self.lms_parquet_path = self.settings.parquet_dir / ADMISSIONS_LMS_PARQUET_FILE
        self.lms_meta_path = self.settings.parquet_dir / ADMISSIONS_LMS_META_FILE

    def _read_file(self, filename: str, content: bytes) -> pl.DataFrame:
        ext = Path(filename).suffix.lower()
        if ext == ".csv" or filename.endswith(".csv"):
            return pl.read_csv(
                io.BytesIO(content),
                infer_schema_length=10000,
                ignore_errors=True,
                truncate_ragged_lines=True,
            )
        if ext in (".xlsx", ".xls"):
            try:
                sheets = pl.read_excel(
                    io.BytesIO(content),
                    sheet_id=0,
                    engine="calamine",
                    raise_if_empty=False,
                )
                frames = [df for df in sheets.values() if df.width > 0 and df.height > 0]
                if frames:
                    return pl.concat(frames, how="diagonal_relaxed")
            except Exception as exc:
                logger.warning("admissions_calamine_failed", error=str(exc))
        raise ValueError(f"Unsupported file type: {ext}. Use .xlsx, .xls, or .csv")

    def _normalize_payments_frame(self, df: pl.DataFrame, source_label: str) -> pl.DataFrame:
        mapped = apply_admissions_mapping(df)
        if mapped.height == 0:
            raise ValueError("Sheet has no data rows")

        for col in ADMISSIONS_COLUMNS:
            if col not in mapped.columns and col not in (
                "match_email",
                "match_phone",
                "is_paid",
                "uploaded_at",
                "source_filename",
            ):
                mapped = mapped.with_columns(pl.lit(None).cast(pl.Utf8).alias(col))

        if "phone" not in mapped.columns:
            mapped = mapped.with_columns(pl.lit(None).cast(pl.Utf8).alias("phone"))

        uploaded_at = datetime.utcnow().isoformat()
        is_paid_flags: List[bool] = []
        for row in mapped.iter_rows(named=True):
            paid_flag = is_paid_value(row.get("paid"))
            status_flag = is_paid_value(row.get("status"))
            is_paid_flags.append(bool(paid_flag or status_flag))

        return (
            mapped.with_columns(
                pl.col("email")
                .map_elements(normalize_match_email, return_dtype=pl.Utf8)
                .alias("match_email"),
                pl.col("phone")
                .map_elements(normalize_phone, return_dtype=pl.Utf8)
                .alias("match_phone"),
                pl.Series("is_paid", is_paid_flags, dtype=pl.Boolean),
                pl.lit(uploaded_at).alias("uploaded_at"),
                pl.lit(source_label).alias("source_filename"),
            ).select(ADMISSIONS_COLUMNS)
        )

    def _normalize_lms_frame(self, df: pl.DataFrame, source_label: str) -> pl.DataFrame:
        mapped = apply_lms_mapping(df)
        if mapped.height == 0:
            raise ValueError("LMS sheet has no data rows")

        for col in ADMISSIONS_LMS_COLUMNS:
            if col not in mapped.columns and col not in (
                "match_email",
                "match_phone",
                "uploaded_at",
                "source_filename",
            ):
                mapped = mapped.with_columns(pl.lit(None).cast(pl.Utf8).alias(col))

        if "phone" not in mapped.columns:
            mapped = mapped.with_columns(pl.lit(None).cast(pl.Utf8).alias("phone"))

        uploaded_at = datetime.utcnow().isoformat()
        return (
            mapped.with_columns(
                pl.col("email")
                .map_elements(normalize_match_email, return_dtype=pl.Utf8)
                .alias("match_email"),
                pl.col("phone")
                .map_elements(normalize_phone, return_dtype=pl.Utf8)
                .alias("match_phone"),
                pl.lit(uploaded_at).alias("uploaded_at"),
                pl.lit(source_label).alias("source_filename"),
            ).select(ADMISSIONS_LMS_COLUMNS)
        )

    def _write_payments_frame(self, frame: pl.DataFrame, source_label: str) -> Dict[str, Any]:
        row_count = frame.height
        tmp_path = self.parquet_path.with_suffix(".tmp.parquet")
        frame.write_parquet(tmp_path)
        tmp_path.replace(self.parquet_path)

        meta = {
            "uploaded_at": datetime.utcnow().isoformat(),
            "source_filename": source_label,
            "row_count": row_count,
            "paid_count": int(frame.filter(pl.col("is_paid")).height),
        }
        self.meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        self.duck_repo.invalidate_metadata_cache()
        return meta

    def _write_lms_frame(self, frame: pl.DataFrame, source_label: str) -> Dict[str, Any]:
        row_count = frame.height
        tmp_path = self.lms_parquet_path.with_suffix(".tmp.parquet")
        frame.write_parquet(tmp_path)
        tmp_path.replace(self.lms_parquet_path)

        verified = 0
        try:
            verified = int(
                frame.filter(
                    pl.col("status").cast(pl.Utf8).str.to_lowercase().str.strip_chars()
                    == "verified"
                ).height
            )
        except Exception:
            verified = 0

        meta = {
            "uploaded_at": datetime.utcnow().isoformat(),
            "source_filename": source_label,
            "row_count": row_count,
            "verified_count": verified,
        }
        self.lms_meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        self.duck_repo.invalidate_metadata_cache()
        return meta

    def _apply_matches_to_master(self) -> Dict[str, Any]:
        """Promote matched DP leads to admission after sheet write/sync."""
        from app.services.ingestion_service import IngestionEngine

        return IngestionEngine(
            duck_repo=self.duck_repo, settings=self.settings
        ).recompute_admission_from_sheets()

    def upload_sheet(self, filename: str, content: bytes) -> Dict[str, Any]:
        if not content:
            raise ValueError("File is empty")
        raw = self._read_file(filename, content)
        frame = self._normalize_payments_frame(raw, filename)
        meta = self._write_payments_frame(frame, filename)
        flags = self._apply_matches_to_master()
        logger.info(
            "admissions_sheet_uploaded",
            filename=filename,
            rows=meta["row_count"],
            newly_marked=flags.get("newly_marked"),
        )
        return {
            "status": "completed",
            "row_count": meta["row_count"],
            "paid_count": meta["paid_count"],
            "source_filename": filename,
            "uploaded_at": meta["uploaded_at"],
            "admission_flags": flags,
            "message": (
                f"Uploaded {meta['row_count']} admission rows from {filename}"
                + (
                    f"; marked {flags.get('newly_marked', 0)} DP leads as admission"
                    if flags.get("newly_marked")
                    else ""
                )
            ),
        }

    def sync_admissions_sheets(self) -> Dict[str, Any]:
        """Pull All Payments + LMS on Sync LSQ — public CSV preferred, else service account."""
        if self.settings.google_admissions_public_csv_configured:
            return self.sync_from_public_csv()
        return self.sync_from_google()

    def sync_from_public_csv(self) -> Dict[str, Any]:
        payments_url = self.settings.google_admissions_payments_csv_url_resolved
        lms_url = self.settings.google_admissions_lms_csv_url_resolved
        if not payments_url and not lms_url:
            return {
                "status": "skipped",
                "row_count": 0,
                "lms_row_count": 0,
                "message": "Admissions public CSV URL not configured",
            }

        import httpx

        results: Dict[str, Any] = {
            "status": "completed",
            "row_count": 0,
            "lms_row_count": 0,
            "paid_count": 0,
            "verified_count": 0,
            "source_filename": None,
            "lms_source_filename": None,
            "uploaded_at": None,
        }
        messages: List[str] = []

        if payments_url:
            try:
                response = httpx.get(payments_url, follow_redirects=True, timeout=120.0)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise ValueError(f"Failed to fetch admissions payments CSV: {exc}") from exc
            content = response.content
            if not content or not content.strip():
                raise ValueError("Admissions payments CSV is empty")
            source_label = "google:public_csv:payments"
            raw = self._read_file("admissions_payments.csv", content)
            frame = self._normalize_payments_frame(raw, source_label)
            meta = self._write_payments_frame(frame, source_label)
            results["row_count"] = meta["row_count"]
            results["paid_count"] = meta["paid_count"]
            results["source_filename"] = source_label
            results["uploaded_at"] = meta["uploaded_at"]
            messages.append(f"payments={meta['row_count']}")

        if lms_url:
            try:
                response = httpx.get(lms_url, follow_redirects=True, timeout=120.0)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise ValueError(f"Failed to fetch admissions LMS CSV: {exc}") from exc
            content = response.content
            if not content or not content.strip():
                raise ValueError("Admissions LMS CSV is empty")
            source_label = "google:public_csv:lms"
            raw = self._read_file("admissions_lms.csv", content)
            frame = self._normalize_lms_frame(raw, source_label)
            meta = self._write_lms_frame(frame, source_label)
            results["lms_row_count"] = meta["row_count"]
            results["verified_count"] = meta["verified_count"]
            results["lms_source_filename"] = source_label
            results["uploaded_at"] = results["uploaded_at"] or meta["uploaded_at"]
            messages.append(f"lms={meta['row_count']}")

        results["message"] = f"Synced admissions sheets ({', '.join(messages)})"
        flags = self._apply_matches_to_master()
        results["admission_flags"] = flags
        if flags.get("newly_marked"):
            results["message"] += f"; DP admissions marked={flags.get('newly_marked')}"
        logger.info("admissions_sheets_synced_public_csv", **results)
        return results

    def sync_from_google(self) -> Dict[str, Any]:
        if not self.settings.google_admissions_api_configured:
            return {
                "status": "skipped",
                "row_count": 0,
                "lms_row_count": 0,
                "message": "Google Sheets API admissions sync not configured",
            }

        import gspread
        from google.oauth2.service_account import Credentials

        creds_path = self.settings.google_service_account_json.strip()
        if not creds_path:
            creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if not creds_path or not Path(creds_path).exists():
            raise ValueError("Google service account credentials file not found")

        scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
        credentials = Credentials.from_service_account_file(creds_path, scopes=scopes)
        client = gspread.authorize(credentials)
        spreadsheet = client.open_by_key(
            self.settings.google_admissions_spreadsheet_id.strip()
        )

        results: Dict[str, Any] = {
            "status": "completed",
            "row_count": 0,
            "lms_row_count": 0,
            "paid_count": 0,
            "verified_count": 0,
            "source_filename": None,
            "lms_source_filename": None,
            "uploaded_at": None,
        }
        messages: List[str] = []

        payments_ws = self._open_worksheet(
            spreadsheet,
            self.settings.google_admissions_payments_sheet_gid.strip(),
            self.settings.google_admissions_payments_sheet_name.strip()
            or "All Payments - Admissions",
        )
        if payments_ws is not None:
            records = payments_ws.get_all_records()
            if records:
                df = pl.DataFrame(records, infer_schema_length=len(records) + 1)
                source_label = f"google:{payments_ws.title}"
                frame = self._normalize_payments_frame(df, source_label)
                meta = self._write_payments_frame(frame, source_label)
                results["row_count"] = meta["row_count"]
                results["paid_count"] = meta["paid_count"]
                results["source_filename"] = source_label
                results["uploaded_at"] = meta["uploaded_at"]
                messages.append(f"payments={meta['row_count']}")

        lms_ws = self._open_worksheet(
            spreadsheet,
            self.settings.google_admissions_lms_sheet_gid.strip(),
            self.settings.google_admissions_lms_sheet_name.strip() or "LMS",
        )
        if lms_ws is not None:
            records = lms_ws.get_all_records()
            if records:
                df = pl.DataFrame(records, infer_schema_length=len(records) + 1)
                source_label = f"google:{lms_ws.title}"
                frame = self._normalize_lms_frame(df, source_label)
                meta = self._write_lms_frame(frame, source_label)
                results["lms_row_count"] = meta["row_count"]
                results["verified_count"] = meta["verified_count"]
                results["lms_source_filename"] = source_label
                results["uploaded_at"] = results["uploaded_at"] or meta["uploaded_at"]
                messages.append(f"lms={meta['row_count']}")

        if not messages:
            raise ValueError("Google admissions sheets have no data rows")

        results["message"] = f"Synced admissions sheets ({', '.join(messages)})"
        flags = self._apply_matches_to_master()
        results["admission_flags"] = flags
        if flags.get("newly_marked"):
            results["message"] += f"; DP admissions marked={flags.get('newly_marked')}"
        logger.info("admissions_sheets_synced_google", **results)
        return results

    def _open_worksheet(self, spreadsheet, gid: str, sheet_name: str) -> Any:
        if gid:
            try:
                return spreadsheet.get_worksheet_by_id(int(gid))
            except (ValueError, TypeError, Exception) as exc:
                logger.warning("admissions_sheet_gid_open_failed", gid=gid, error=str(exc))
        if sheet_name:
            try:
                return spreadsheet.worksheet(sheet_name)
            except Exception as exc:
                logger.warning(
                    "admissions_sheet_name_open_failed",
                    sheet_name=sheet_name,
                    error=str(exc),
                )
        return None

    def get_status(self) -> Dict[str, Any]:
        payments_meta: Dict[str, Any] = {}
        if self.meta_path.exists():
            try:
                payments_meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
            except Exception:
                payments_meta = {}

        lms_meta: Dict[str, Any] = {}
        if self.lms_meta_path.exists():
            try:
                lms_meta = json.loads(self.lms_meta_path.read_text(encoding="utf-8"))
            except Exception:
                lms_meta = {}

        has_payments = self.duck_repo.admissions_exists()
        has_lms = self.duck_repo.admissions_lms_exists()

        row_count = int(payments_meta.get("row_count") or 0)
        paid_count = int(payments_meta.get("paid_count") or 0)
        lms_row_count = int(lms_meta.get("row_count") or 0)
        verified_count = int(lms_meta.get("verified_count") or 0)

        if has_payments:
            try:
                rows = self.duck_repo.query_dicts(
                    "SELECT COUNT(*) AS cnt FROM admissions_tracking WHERE is_paid"
                )
                paid_count = int(rows[0]["cnt"]) if rows else paid_count
            except Exception:
                pass

        if has_lms:
            try:
                rows = self.duck_repo.query_dicts(
                    """
                    SELECT COUNT(*) AS cnt FROM admissions_lms_tracking
                    WHERE LOWER(TRIM(COALESCE(status, ''))) = 'verified'
                    """
                )
                verified_count = int(rows[0]["cnt"]) if rows else verified_count
            except Exception:
                pass

        return {
            "has_data": has_payments or has_lms,
            "has_payments": has_payments,
            "has_lms": has_lms,
            "row_count": row_count,
            "paid_count": paid_count,
            "lms_row_count": lms_row_count,
            "verified_count": verified_count,
            "source_filename": payments_meta.get("source_filename"),
            "lms_source_filename": lms_meta.get("source_filename"),
            "uploaded_at": payments_meta.get("uploaded_at") or lms_meta.get("uploaded_at"),
            "google_configured": self.settings.google_admissions_configured,
            "public_csv_configured": self.settings.google_admissions_public_csv_configured,
            "service_account_configured": self.settings.google_sheets_service_account_configured,
        }
