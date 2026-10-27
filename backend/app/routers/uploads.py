import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from app.config import get_settings
from app.deps import workspace_or_404
from app.models import Workspace

router = APIRouter(prefix="/api/workspaces/{workspace_id}/uploads", tags=["uploads"])

_CHUNK = 1024 * 1024


@router.post("")
async def upload(file: UploadFile, ws: Workspace = Depends(workspace_or_404)):
    """Store a file and return a public URL WhatsApp can download it from."""
    settings = get_settings()
    limit = settings.max_upload_mb * 1024 * 1024
    ext = Path(file.filename or "").suffix.lower()[:10]
    if ext and not ext[1:].isalnum():
        ext = ""
    name = f"{uuid.uuid4().hex}{ext}"
    folder = Path(settings.media_dir) / str(ws.id)
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / name

    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(_CHUNK):
            size += len(chunk)
            if size > limit:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File is larger than {settings.max_upload_mb} MB")
            out.write(chunk)

    return {
        "url": f"{settings.public_base_url.rstrip('/')}/media/{ws.id}/{name}",
        "filename": file.filename,
        "content_type": file.content_type,
        "size": size,
    }
