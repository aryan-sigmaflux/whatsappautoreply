from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.deps import current_user, workspace_or_404
from app.models import Workspace, new_webhook_token
from app.schemas import TestSendIn, WorkspaceIn, WorkspaceOut
from app.security import decrypt, encrypt, mask
from app.services import getgabs

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"], dependencies=[Depends(current_user)])


def to_out(ws: Workspace) -> WorkspaceOut:
    key = decrypt(ws.api_key_encrypted) if ws.api_key_encrypted else None
    return WorkspaceOut(
        id=ws.id,
        name=ws.name,
        is_active=ws.is_active,
        has_api_key=bool(key),
        api_key_masked=mask(key) if key else None,
        webhook_url=f"{get_settings().public_base_url.rstrip('/')}/webhook/{ws.webhook_token}",
        last_webhook_at=ws.last_webhook_at,
        created_at=ws.created_at,
    )


def _apply(ws: Workspace, body: WorkspaceIn) -> None:
    ws.name = body.name.strip()
    ws.is_active = body.is_active
    if body.api_key is not None:
        key = body.api_key.strip()
        ws.api_key_encrypted = encrypt(key) if key else None


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(Workspace).order_by(Workspace.created_at))
    return [to_out(ws) for ws in rows]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
async def create_workspace(body: WorkspaceIn, db: AsyncSession = Depends(get_db)):
    ws = Workspace()
    _apply(ws, body)
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return to_out(ws)


@router.get("/{workspace_id}", response_model=WorkspaceOut)
async def get_workspace(ws: Workspace = Depends(workspace_or_404)):
    return to_out(ws)


@router.put("/{workspace_id}", response_model=WorkspaceOut)
async def update_workspace(
    body: WorkspaceIn, ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)
):
    _apply(ws, body)
    await db.commit()
    await db.refresh(ws)
    return to_out(ws)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    await db.delete(ws)
    await db.commit()


@router.post("/{workspace_id}/rotate-webhook", response_model=WorkspaceOut)
async def rotate_webhook(ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    """Issue a new webhook URL; the old one stops working immediately."""
    ws.webhook_token = new_webhook_token()
    await db.commit()
    await db.refresh(ws)
    return to_out(ws)


@router.post("/{workspace_id}/test-send")
async def test_send(body: TestSendIn, ws: Workspace = Depends(workspace_or_404)):
    """Send a plain text message to check the API key works."""
    key = decrypt(ws.api_key_encrypted) if ws.api_key_encrypted else None
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add the GetGabs API key first")
    to = "".join(ch for ch in body.to if ch.isdigit())
    try:
        result = await getgabs.send(key, to, getgabs.build_message("text", {"body": body.text}))
    except getgabs.GetGabsError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    return {"ok": True, "result": result}
