"""Persona last-24h activity report upload API."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.dependencies import require_write_access
from app.domain.models import UserInfo
from app.logging_config import get_logger
from app.services.persona_activity_service import PersonaActivityService

router = APIRouter(prefix="/persona-activity", tags=["persona-activity"])
logger = get_logger(__name__)


def get_persona_activity_service() -> PersonaActivityService:
    return PersonaActivityService()


@router.get("/status")
async def persona_activity_status(
    service: PersonaActivityService = Depends(get_persona_activity_service),
):
    return service.get_status()


@router.post("/upload")
async def upload_persona_activity_sheet(
    file: UploadFile = File(...),
    user: UserInfo = Depends(require_write_access),
    service: PersonaActivityService = Depends(get_persona_activity_service),
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
            "persona_activity_uploaded",
            user=user.username,
            filename=file.filename,
            rows=result.get("row_count"),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("persona_activity_upload_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {exc}",
        ) from exc
