"""Logs tab: every request GetGabs sent to the workspace's webhook URL, newest first."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import workspace_or_404
from app.models import WebhookLog, Workspace
from app.schemas import WebhookLogOut

router = APIRouter(prefix="/api/workspaces/{workspace_id}/logs", tags=["logs"])


@router.get("", response_model=list[WebhookLogOut])
async def list_logs(
    q: str = Query(default="", max_length=100),
    status: str = Query(default="", max_length=16),
    text: str = Query(default="", max_length=500, description="Only messages containing this text"),
    before: int | None = Query(default=None, description="Only rows older than this id (paging)"),
    limit: int = Query(default=100, ge=1, le=200),
    ws: Workspace = Depends(workspace_or_404),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(WebhookLog).where(WebhookLog.workspace_id == ws.id)
    if before is not None:
        stmt = stmt.where(WebhookLog.id < before)
    if status:
        stmt = stmt.where(WebhookLog.status == status)
    if text.strip():
        stmt = stmt.where(WebhookLog.text.icontains(text.strip(), autoescape=True))
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(WebhookLog.contact.ilike(like), WebhookLog.name.ilike(like), WebhookLog.text.ilike(like))
        )
    return list(await db.scalars(stmt.order_by(WebhookLog.id.desc()).limit(limit)))
