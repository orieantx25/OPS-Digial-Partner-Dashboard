"""Domain models and DTOs."""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class UserRole(str, Enum):
    ADMIN = "admin"
    OPERATIONS = "operations"
    MANAGEMENT = "management"
    PARTNER = "partner"
    READ_ONLY = "read_only"


class UploadStatus(str, Enum):
    PENDING = "pending"
    VALIDATING = "validating"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class ValidationIssueType(str, Enum):
    MISSING_COLUMN = "missing_column"
    WRONG_DATATYPE = "wrong_datatype"
    BLANK_PROSPECT_ID = "blank_prospect_id"
    DUPLICATE_PROSPECT_ID = "duplicate_prospect_id"
    INVALID_DATE = "invalid_date"
    CORRUPT_FILE = "corrupt_file"
    INVALID_FILE_TYPE = "invalid_file_type"


class ValidationIssue(BaseModel):
    issue_type: ValidationIssueType
    message: str
    row_number: Optional[int] = None
    column: Optional[str] = None
    value: Optional[str] = None
    prospect_id: Optional[str] = None


class FileUploadResult(BaseModel):
    filename: str
    rows_read: int = 0
    rows_accepted: int = 0
    rows_rejected: int = 0
    issues: List[ValidationIssue] = Field(default_factory=list)
    rejection_summary: Dict[str, int] = Field(default_factory=dict)
    success: bool = True


class UploadReport(BaseModel):
    batch_id: str
    status: UploadStatus
    started_at: datetime
    completed_at: Optional[datetime] = None
    total_files: int = 0
    total_rows_read: int = 0
    total_rows_accepted: int = 0
    total_rows_rejected: int = 0
    duplicate_prospect_ids: List[str] = Field(default_factory=list)
    duplicate_count: int = 0
    file_results: List[FileUploadResult] = Field(default_factory=list)
    issues: List[ValidationIssue] = Field(default_factory=list)
    rejection_summary: Dict[str, int] = Field(default_factory=dict)
    master_dataset_total_rows: int = 0
    message: str = ""


class FilterParams(BaseModel):
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    week: Optional[str] = None
    month: Optional[str] = None
    quarter: Optional[str] = None
    year: Optional[int] = None
    partner: Optional[List[str]] = None
    state: Optional[List[str]] = None
    city: Optional[List[str]] = None
    persona: Optional[List[str]] = None
    lead_stage: Optional[List[str]] = None
    contact_stage: Optional[List[str]] = None
    ai_status: Optional[List[str]] = None
    campaign: Optional[List[str]] = None
    source: Optional[List[str]] = None
    medium: Optional[List[str]] = None
    device: Optional[List[str]] = None
    prospect_id: Optional[str] = None
    search: Optional[str] = None
    lead_filter: Optional[str] = None


class KpiMetric(BaseModel):
    key: str
    label: str
    current: float
    previous: float
    change_pct: float
    trend: List[float] = Field(default_factory=list)


class ChartSeries(BaseModel):
    name: str
    data: List[Any]


class ChartData(BaseModel):
    chart_id: str
    chart_type: str
    title: str
    categories: List[str] = Field(default_factory=list)
    series: List[ChartSeries] = Field(default_factory=list)
    extra: Dict[str, Any] = Field(default_factory=dict)


class AlertItem(BaseModel):
    alert_type: str
    severity: str
    title: str
    message: str
    metric_value: Optional[float] = None
    threshold: Optional[float] = None
    created_at: datetime


class PaginatedResponse(BaseModel):
    items: List[Dict[str, Any]]
    total: int
    page: int
    page_size: int
    total_pages: int


class UserInfo(BaseModel):
    id: str
    username: str
    role: UserRole
    partner_scope: Optional[str] = None
