"""Refund cases sheet — Google Sheets sync and manual upload."""

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
    REFUND_COLUMN_ALIASES,
    REFUND_COLUMNS,
    REFUND_META_FILE,
    REFUND_PARQUET_FILE,
)
from app.infrastructure.duckdb_repo import DuckDBRepository
from app.logging_config import get_logger
from app.services.block_payment_service import normalize_match_email
from app.services.ingestion_service import normalize_phone

logger = get_logger(__name__)


def normalize_refund_header(header: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(header).strip().lower())
    if cleaned in REFUND_COLUMN_ALIASES:
        return REFUND_COLUMN_ALIASES[cleaned]
    without_auto = re.sub(r"\s*\(auto\)\s*$", "", cleaned).strip()
    if without_auto in REFUND_COLUMN_ALIASES:
        return REFUND_COLUMN_ALIASES[without_auto]
    return without_auto.replace(" ", "_")


def normalize_provisional_id(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().upper()
    return text if text and text not in {"(BLANK)", "NA", "N/A", "-"} else None


def is_on_hold_sst_status(value: Optional[str]) -> bool:
    """Final statuses held by SST are not treated as refund applied."""
    if value is None:
        return False
    text = re.sub(r"\s+", " ", str(value).strip().lower())
    if not text:
        return False
    return "on hold" in text and "sst" in text


def is_refund_final_status(value: Optional[str]) -> bool:
    if value is None:
        return False
    text = str(value).strip().lower()
    if not text:
        return False
    # On hold as per SST team (and variants) must not count as refund applied.
    if is_on_hold_sst_status(text):
        return False
    return "refund" in text


def apply_refund_mapping(df: pl.DataFrame) -> pl.DataFrame:
    groups: Dict[str, List[str]] = {}
    for col in df.columns:
        canon = normalize_refund_header(col)
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


class RefundService:
    """Persist refund tracking sheet and sync from Google Sheets."""

    def __init__(
        self,
        duck_repo: Optional[DuckDBRepository] = None,
        settings: Optional[Settings] = None,
    ):
        self.settings = settings or get_settings()
        self.duck_repo = duck_repo or DuckDBRepository(self.settings)
        self.parquet_path = self.settings.parquet_dir / REFUND_PARQUET_FILE
        self.meta_path = self.settings.parquet_dir / REFUND_META_FILE

    def _read_file(self, filename: str, content: bytes) -> pl.DataFrame:
        ext = Path(filename).suffix.lower()
        if ext == ".csv":
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
                logger.warning("refund_calamine_failed", error=str(exc))
        raise ValueError(f"Unsupported file type: {ext}. Use .xlsx, .xls, or .csv")

    def _normalize_frame(self, df: pl.DataFrame, source_label: str) -> pl.DataFrame:
        mapped = apply_refund_mapping(df)
        if mapped.height == 0:
            raise ValueError("Sheet has no data rows")

        for col in REFUND_COLUMNS:
            if col not in mapped.columns and col not in (
                "match_email",
                "match_phone",
                "match_provisional_id",
                "is_refund",
                "uploaded_at",
                "source_filename",
            ):
                mapped = mapped.with_columns(pl.lit(None).cast(pl.Utf8).alias(col))

        uploaded_at = datetime.utcnow().isoformat()
        is_refund_flags = [
            is_refund_final_status(row.get("final_status"))
            for row in mapped.select(["final_status"]).iter_rows(named=True)
        ]

        normalized = (
            mapped.with_columns(
                pl.col("email").map_elements(normalize_match_email, return_dtype=pl.Utf8).alias("match_email"),
                pl.col("phone").map_elements(normalize_phone, return_dtype=pl.Utf8).alias("match_phone"),
                pl.col("provisional_id")
                .map_elements(normalize_provisional_id, return_dtype=pl.Utf8)
                .alias("match_provisional_id"),
                pl.Series("is_refund", is_refund_flags, dtype=pl.Boolean),
                pl.lit(uploaded_at).alias("uploaded_at"),
                pl.lit(source_label).alias("source_filename"),
            )
            .select(REFUND_COLUMNS)
        )
        return normalized

    def _write_frame(self, frame: pl.DataFrame, source_label: str) -> Dict[str, Any]:
        row_count = frame.height
        tmp_path = self.parquet_path.with_suffix(".tmp.parquet")
        frame.write_parquet(tmp_path)
        tmp_path.replace(self.parquet_path)

        meta = {
            "uploaded_at": datetime.utcnow().isoformat(),
            "source_filename": source_label,
            "row_count": row_count,
        }
        self.meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        self.duck_repo.invalidate_metadata_cache()
        return meta

    def upload_sheet(self, filename: str, content: bytes) -> Dict[str, Any]:
        if not content:
            raise ValueError("File is empty")
        raw = self._read_file(filename, content)
        frame = self._normalize_frame(raw, filename)
        meta = self._write_frame(frame, filename)
        logger.info("refund_sheet_uploaded", filename=filename, rows=meta["row_count"])
        return {
            "status": "completed",
            "row_count": meta["row_count"],
            "source_filename": filename,
            "uploaded_at": meta["uploaded_at"],
            "message": f"Uploaded {meta['row_count']} refund rows from {filename}",
        }

    def sync_refund_sheet(self) -> Dict[str, Any]:
        """Pull refund sheet on Sync LSQ — public CSV (link-viewable) or service account API."""
        if self.settings.google_refund_public_csv_configured:
            return self.sync_from_public_csv()
        return self.sync_from_google()

    def sync_from_public_csv(self) -> Dict[str, Any]:
        url = self.settings.google_refund_public_csv_url_resolved
        if not url:
            return {
                "status": "skipped",
                "row_count": 0,
                "message": "Refund public CSV URL not configured",
            }

        import httpx

        try:
            response = httpx.get(url, follow_redirects=True, timeout=120.0)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ValueError(f"Failed to fetch refund sheet CSV: {exc}") from exc

        content = response.content
        if not content or not content.strip():
            raise ValueError("Refund sheet CSV is empty")

        source_label = "google:public_csv"
        raw = self._read_file("refund_sheet.csv", content)
        frame = self._normalize_frame(raw, source_label)
        meta = self._write_frame(frame, source_label)
        logger.info("refund_sheet_synced_public_csv", rows=meta["row_count"], url=url)
        return {
            "status": "completed",
            "row_count": meta["row_count"],
            "source_filename": meta["source_filename"],
            "uploaded_at": meta["uploaded_at"],
            "message": f"Synced {meta['row_count']} refund rows from public Google Sheet CSV",
        }

    def sync_from_google(self) -> Dict[str, Any]:
        if not self.settings.google_sheets_api_configured:
            return {
                "status": "skipped",
                "row_count": 0,
                "message": "Google Sheets API refund sync not configured (no service account)",
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
        spreadsheet = client.open_by_key(self.settings.google_refund_spreadsheet_id.strip())
        worksheet = self._open_refund_worksheet(spreadsheet)
        sheet_label = worksheet.title
        records = worksheet.get_all_records()
        if not records:
            raise ValueError("Google Sheet has no data rows")

        df = pl.DataFrame(records, infer_schema_length=len(records) + 1)
        frame = self._normalize_frame(df, f"google:{sheet_label}")
        meta = self._write_frame(frame, f"google:{sheet_label}")
        logger.info("refund_sheet_synced_google", rows=meta["row_count"], sheet=sheet_label)
        return {
            "status": "completed",
            "row_count": meta["row_count"],
            "source_filename": meta["source_filename"],
            "uploaded_at": meta["uploaded_at"],
            "message": f"Synced {meta['row_count']} refund rows from Google Sheet ({sheet_label})",
        }

    def _open_refund_worksheet(self, spreadsheet) -> Any:
        gid = self.settings.google_refund_sheet_gid.strip()
        if gid:
            try:
                return spreadsheet.get_worksheet_by_id(int(gid))
            except (ValueError, TypeError):
                logger.warning("refund_sheet_gid_invalid", gid=gid)

        sheet_name = self.settings.google_refund_sheet_name.strip()
        if sheet_name:
            return spreadsheet.worksheet(sheet_name)

        return spreadsheet.get_worksheet(0)

    def get_status(self) -> Dict[str, Any]:
        if not self.duck_repo.refund_exists():
            return {
                "has_data": False,
                "row_count": 0,
                "refund_count": 0,
                "source_filename": None,
                "uploaded_at": None,
                "google_configured": self.settings.google_sheets_configured,
                "public_csv_configured": self.settings.google_refund_public_csv_configured,
                "service_account_configured": self.settings.google_sheets_service_account_configured,
            }

        meta: Dict[str, Any] = {}
        if self.meta_path.exists():
            try:
                meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}

        row_count = int(meta.get("row_count") or 0)
        refund_count = 0
        try:
            rows = self.duck_repo.query_dicts(
                f"SELECT COUNT(*) AS cnt FROM refund_tracking WHERE is_refund"
            )
            refund_count = int(rows[0]["cnt"]) if rows else 0
        except Exception:
            pass

        return {
            "has_data": True,
            "row_count": row_count,
            "refund_count": refund_count,
            "source_filename": meta.get("source_filename"),
            "uploaded_at": meta.get("uploaded_at"),
            "google_configured": self.settings.google_sheets_configured,
            "public_csv_configured": self.settings.google_refund_public_csv_configured,
            "service_account_configured": self.settings.google_sheets_service_account_configured,
        }
