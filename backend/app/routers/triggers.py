import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user, workspace_or_404
from app.models import Trigger, User, Workspace
from app.schemas import (
    BulkDeleteIn,
    TriggerIn,
    TriggerOut,
    TriggerStatusIn,
    TryMessageIn,
    TryMessageOut,
)
from app.services.matcher import extract_text, find_match

router = APIRouter(prefix="/api/workspaces/{workspace_id}/triggers", tags=["triggers"])


async def _get(db: AsyncSession, ws: Workspace, trigger_id: uuid.UUID) -> Trigger:
    t = await db.get(Trigger, trigger_id)
    if not t or t.workspace_id != ws.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trigger not found")
    return t


async def _reload(db: AsyncSession, trigger_id: uuid.UUID) -> Trigger:
    # Fresh load so updated_at and the created_by / updated_by joins are current.
    return await db.get(Trigger, trigger_id, populate_existing=True)


@router.get("", response_model=list[TriggerOut])
async def list_triggers(ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(
        select(Trigger).where(Trigger.workspace_id == ws.id).order_by(Trigger.created_at.desc())
    )
    return list(rows)


@router.post("", response_model=TriggerOut, status_code=status.HTTP_201_CREATED)
async def create_trigger(
    body: TriggerIn,
    ws: Workspace = Depends(workspace_or_404),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    t = Trigger(workspace_id=ws.id, created_by_id=user.id, updated_by_id=user.id, **body.model_dump())
    db.add(t)
    await db.commit()
    return await _reload(db, t.id)


@router.post("/try", response_model=TryMessageOut)
async def try_message(body: TryMessageIn, ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    """Which trigger would answer this message? Nothing is sent."""
    text = "" if body.message_type == "media" else body.message
    triggers = list(await db.scalars(select(Trigger).where(Trigger.workspace_id == ws.id)))
    match = find_match(triggers, extract_text({"message_text": text, "message_type": body.message_type}), body.source)
    if not match:
        reason = "No active trigger matches this message, so no reply would be sent."
        return TryMessageOut(trigger=None, matched_keyword=None, reason=reason)
    return TryMessageOut(trigger=match.trigger, matched_keyword=match.keyword, reason=match.reason)


@router.post("/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
async def bulk_delete(body: BulkDeleteIn, ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Trigger).where(Trigger.workspace_id == ws.id, Trigger.id.in_(body.ids)))
    await db.commit()


@router.get("/{trigger_id}", response_model=TriggerOut)
async def get_trigger(trigger_id: uuid.UUID, ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    return await _get(db, ws, trigger_id)


@router.put("/{trigger_id}", response_model=TriggerOut)
async def update_trigger(
    trigger_id: uuid.UUID,
    body: TriggerIn,
    ws: Workspace = Depends(workspace_or_404),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    t = await _get(db, ws, trigger_id)
    for field, value in body.model_dump().items():
        setattr(t, field, value)
    t.updated_by_id = user.id
    await db.commit()
    return await _reload(db, t.id)


@router.patch("/{trigger_id}/status", response_model=TriggerOut)
async def set_status(
    trigger_id: uuid.UUID,
    body: TriggerStatusIn,
    ws: Workspace = Depends(workspace_or_404),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    t = await _get(db, ws, trigger_id)
    t.is_active = body.is_active
    t.updated_by_id = user.id
    await db.commit()
    return await _reload(db, t.id)


@router.delete("/{trigger_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trigger(trigger_id: uuid.UUID, ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    await db.delete(await _get(db, ws, trigger_id))
    await db.commit()
