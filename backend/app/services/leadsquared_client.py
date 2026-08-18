"""LeadSquared API client — credentials from environment only."""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Iterator, List, Optional
from urllib.parse import urlencode

import httpx

from app.config import Settings, get_settings
from app.logging_config import get_logger

logger = get_logger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)

LSQ_DATETIME_FMT = "%Y-%m-%d %H:%M:%S"
DEFAULT_PAGE_SIZE = 1000
ACTIVITY_PAGE_SIZE = 200
ACTIVITY_CHUNK_HOURS = 6
MAX_PAGE_SIZE = 5000
MAX_RETRIES = 5
RETRY_BACKOFF_SECONDS = 2.0
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class LeadSquaredError(Exception):
    """LeadSquared API call failed."""


def _redact_secrets(text: str, access_key: str, secret_key: str) -> str:
    redacted = text
    if access_key:
        redacted = redacted.replace(access_key, "***")
    if secret_key:
        redacted = redacted.replace(secret_key, "***")
    redacted = re.sub(r"(accessKey=)[^&]+", r"\1***", redacted, flags=re.IGNORECASE)
    redacted = re.sub(r"(secretKey=)[^&]+", r"\1***", redacted, flags=re.IGNORECASE)
    return redacted


def _is_retryable_error(status_code: int, body: str) -> bool:
    if status_code in RETRYABLE_STATUS:
        return True
    blob = (body or "").lower()
    return "mysqlexception" in blob or "error processing the request" in blob


def format_lsq_datetime(dt: datetime) -> str:
    return dt.strftime(LSQ_DATETIME_FMT)


def _clamp_page_size(page_size: int) -> int:
    return max(1, min(int(page_size), MAX_PAGE_SIZE))


class LeadSquaredClient:
    """Thin HTTP client for LeadSquared v2 read APIs with connection reuse."""

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        host = self.settings.leadsquared_api_host.rstrip("/")
        self.base_url = host
        self._access_key = self.settings.leadsquared_access_key
        self._secret_key = self.settings.leadsquared_secret_key
        self.default_page_size = _clamp_page_size(
            getattr(self.settings, "leadsquared_page_size", DEFAULT_PAGE_SIZE)
        )
        self._client: Optional[httpx.Client] = None
        self._owns_client = False

    def __enter__(self) -> "LeadSquaredClient":
        self.open()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def open(self) -> None:
        if self._client is None:
            self._client = httpx.Client(timeout=120.0)
            self._owns_client = True

    def close(self) -> None:
        if self._client is not None and self._owns_client:
            self._client.close()
        self._client = None
        self._owns_client = False

    def _auth_query(self) -> str:
        return urlencode(
            {
                "accessKey": self._access_key,
                "secretKey": self._secret_key,
            }
        )

    def _url(self, path: str) -> str:
        path = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}{path}?{self._auth_query()}"

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        url = self._url(path)
        last_exc: Optional[Exception] = None
        ephemeral = self._client is None
        client = self._client or httpx.Client(timeout=120.0)
        try:
            for attempt in range(MAX_RETRIES):
                try:
                    response = client.post(url, json=body)
                    body_text = response.text or ""
                    retryable = _is_retryable_error(response.status_code, body_text)
                    if retryable and attempt < MAX_RETRIES - 1:
                        wait = RETRY_BACKOFF_SECONDS * (2 ** attempt)
                        logger.warning(
                            "lsq_retry",
                            status=response.status_code,
                            attempt=attempt + 1,
                            wait_s=wait,
                            path=path,
                        )
                        time.sleep(wait)
                        continue
                    if response.status_code >= 400:
                        detail = _redact_secrets(
                            body_text[:500],
                            self._access_key,
                            self._secret_key,
                        )
                        raise LeadSquaredError(
                            f"LeadSquared API error {response.status_code}: {detail}"
                        )
                    data = response.json()
                    if isinstance(data, dict) and data.get("Status") == "Error":
                        encoded = str(data)
                        if attempt < MAX_RETRIES - 1 and _is_retryable_error(
                            response.status_code, encoded
                        ):
                            wait = RETRY_BACKOFF_SECONDS * (2 ** attempt)
                            logger.warning(
                                "lsq_retry",
                                status=response.status_code,
                                attempt=attempt + 1,
                                wait_s=wait,
                                path=path,
                            )
                            time.sleep(wait)
                            continue
                        msg = _redact_secrets(
                            str(data.get("ExceptionMessage") or data),
                            self._access_key,
                            self._secret_key,
                        )
                        raise LeadSquaredError(msg)
                    return data if isinstance(data, dict) else {"data": data}
                except httpx.HTTPError as exc:
                    last_exc = exc
                    if attempt < MAX_RETRIES - 1:
                        time.sleep(RETRY_BACKOFF_SECONDS * (2 ** attempt))
                        continue
            raise LeadSquaredError(
                _redact_secrets(str(last_exc), self._access_key, self._secret_key)
            )
        finally:
            if ephemeral:
                client.close()

    def get_leads_metadata(self) -> Dict[str, Any]:
        return self._post("/LeadManagement.svc/LeadsMetaData.Get", {})

    def iter_recently_modified_leads(
        self,
        from_date: datetime,
        to_date: datetime,
        include_csv: str,
        page_size: Optional[int] = None,
    ) -> Iterator[List[Dict[str, Any]]]:
        """Yield pages of lead records (each lead is a dict of attribute -> value)."""
        page_size = _clamp_page_size(page_size if page_size is not None else self.default_page_size)
        page_index = 1
        while True:
            body = {
                "Parameter": {
                    "FromDate": format_lsq_datetime(from_date),
                    "ToDate": format_lsq_datetime(to_date),
                },
                "Columns": {"Include_CSV": include_csv},
                "Paging": {"PageIndex": page_index, "PageSize": page_size},
                "Sorting": {"ColumnName": "ProspectAutoId", "Direction": "1"},
            }
            payload = self._post("/LeadManagement.svc/Leads.RecentlyModified", body)
            leads_raw = payload.get("Leads") or []
            if not leads_raw:
                break
            page: List[Dict[str, Any]] = []
            for item in leads_raw:
                props = item.get("LeadPropertyList") or []
                row = {
                    p.get("Attribute"): p.get("Value")
                    for p in props
                    if p.get("Attribute") is not None
                }
                page.append(row)
            yield page
            record_count = int(payload.get("RecordCount") or len(leads_raw))
            if record_count < page_size:
                break
            page_index += 1

    def fetch_leads_window(
        self,
        from_date: datetime,
        to_date: datetime,
        include_csv: str,
        page_size: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch all leads for a date window into a single list."""
        rows: List[Dict[str, Any]] = []
        for page in self.iter_recently_modified_leads(
            from_date, to_date, include_csv, page_size=page_size
        ):
            rows.extend(page)
        return rows

    def iter_leads_by_lookup(
        self,
        lookup_name: str,
        lookup_value: str,
        include_csv: str,
        page_size: Optional[int] = None,
        sql_operator: str = "=",
    ) -> Iterator[List[Dict[str, Any]]]:
        """Yield pages from Leads.Get filtered by a single field lookup."""
        page_size = _clamp_page_size(page_size if page_size is not None else self.default_page_size)
        page_index = 1
        while True:
            body = {
                "Parameter": {
                    "LookupName": lookup_name,
                    "LookupValue": lookup_value,
                    "SqlOperator": sql_operator,
                },
                "Columns": {"Include_CSV": include_csv},
                "Paging": {"PageIndex": page_index, "PageSize": page_size},
            }
            payload = self._post("/LeadManagement.svc/Leads.Get", body)
            leads = payload.get("data") or payload.get("Leads") or []
            if not leads:
                break
            # RecentlyModified returns LeadPropertyList; Leads.Get returns flat dicts.
            page: List[Dict[str, Any]] = []
            for item in leads:
                if isinstance(item, dict) and item.get("LeadPropertyList"):
                    props = item.get("LeadPropertyList") or []
                    page.append(
                        {
                            p.get("Attribute"): p.get("Value")
                            for p in props
                            if p.get("Attribute") is not None
                        }
                    )
                elif isinstance(item, dict):
                    page.append(item)
            if not page:
                break
            yield page
            if len(leads) < page_size:
                break
            page_index += 1
            if page_index > 200:
                break

    def fetch_leads_by_lookup(
        self,
        lookup_name: str,
        lookup_value: str,
        include_csv: str,
        page_size: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for page in self.iter_leads_by_lookup(
            lookup_name, lookup_value, include_csv, page_size=page_size
        ):
            rows.extend(page)
        return rows

    def iter_recently_modified_activities(
        self,
        from_date: datetime,
        to_date: datetime,
        page_size: Optional[int] = None,
    ) -> Iterator[List[Dict[str, Any]]]:
        """Yield activity pages in small windows — LSQ MySQL 500s on large activity queries."""
        page_size = _clamp_page_size(
            page_size if page_size is not None else ACTIVITY_PAGE_SIZE
        )
        cursor = from_date
        while cursor < to_date:
            window_end = min(cursor + timedelta(hours=ACTIVITY_CHUNK_HOURS), to_date)
            page_index = 1
            while True:
                body = {
                    "Parameter": {
                        "FromDate": format_lsq_datetime(cursor),
                        "ToDate": format_lsq_datetime(window_end),
                        "IncludeCustomFields": 1,
                    },
                    "Paging": {"PageIndex": page_index, "PageSize": page_size},
                    "Sorting": {"ColumnName": "CreatedOn", "Direction": 1},
                }
                payload = self._post(
                    "/ProspectActivity.svc/RetrieveRecentlyModified", body
                )
                activities = payload.get("ProspectActivities") or []
                if not activities:
                    break
                yield activities
                if len(activities) < page_size:
                    break
                total = int(payload.get("RecordCount") or 0)
                if total and page_index * page_size >= total:
                    break
                page_index += 1
            cursor = window_end
