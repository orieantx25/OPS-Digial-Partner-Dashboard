"""Refund cases sheet — Google Sheets sync and manual upload."""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.api.dependencies import get_analytics_engine, parse_filters, require_authenticated_user, require_write_access
from app.domain.models import FilterParams, PaginatedResponse, UserInfo
from app.logging_config import get_logger
from app.services.analytics_service import AnalyticsEngine
from app.services.refund_service import RefundService

router = APIRouter(prefix="/refunds", tags=["refunds"])
logger = get_logger(__name__)


def get_refund_service() -> RefundService:
    return RefundService()


@router.get("/status")
async def refund_status(
    service: RefundService = Depends(get_refund_service),
    user: UserInfo = Depends(require_authenticated_user),
):
    return service.get_status()


@router.post("/upload")
async def upload_refund_sheet(
    file: UploadFile = File(...),
    service: RefundService = Depends(get_refund_service),
    user: UserInfo = Depends(require_write_access),
):
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided",
        )

    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ("xlsx", "xls", "csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Use .xlsx, .xls, or .csv",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File is empty",
        )

    try:
        result = service.upload_sheet(file.filename, content)
        logger.info(
            "refund_uploaded",
            user=user.username,
            filename=file.filename,
            rows=result.get("row_count"),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("refund_upload_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {exc}",
        ) from exc


@router.get("/cases")
async def refund_cases(
    filters: FilterParams = Depends(parse_filters),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    engine: AnalyticsEngine = Depends(get_analytics_engine),
) -> PaginatedResponse:
    return engine.get_refund_cases(filters, page=page, page_size=page_size)
