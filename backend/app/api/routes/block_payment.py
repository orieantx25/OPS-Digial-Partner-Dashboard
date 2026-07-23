"""Block payment back-tracking upload API."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.logging_config import get_logger
from app.services.block_payment_service import BlockPaymentService

router = APIRouter(prefix="/block-payment", tags=["block-payment"])
logger = get_logger(__name__)


def get_block_payment_service() -> BlockPaymentService:
    return BlockPaymentService()


@router.get("/status")
async def block_payment_status(
    service: BlockPaymentService = Depends(get_block_payment_service),
):
    return service.get_status()


@router.post("/upload")
async def upload_block_payment_sheet(
    file: UploadFile = File(...),
    service: BlockPaymentService = Depends(get_block_payment_service),
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
            "block_payment_uploaded",
            user="anonymous",
            filename=file.filename,
            rows=result.get("row_count"),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("block_payment_upload_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {exc}",
        ) from exc
