"""
Inbound webhook. Each workspace gets its own URL, /webhook/{token}, which is
pasted into that GetGabs account — the token is how we tell accounts apart,
since GetGabs payloads carry no account id or signature.

GetGabs treats anything but a quick 200 as a failure and retries, so we
acknowledge immediately, de-duplicate on message_id, and reply in the background
(app/services/conversation.py decides what to send).
"""

import json
from datetime import datetime, timezone
from urllib.parse import parse_qs

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import ProcessedMessage, Workspace
from app.services import conversation

router = APIRouter(tags=["webhook"])


async def _read_payload(request: Request) -> dict:
    raw = await request.body()
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        data = {k: v[0] for k, v in parse_qs(raw.decode(errors="replace")).items()}
    return data if isinstance(data, dict) else {}


@router.post("/webhook/{token}")
async def receive(token: str, request: Request, background: BackgroundTasks):
    payload = await _read_payload(request)

    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace).where(Workspace.webhook_token == token))
        if not ws:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown webhook")
        ws.last_webhook_at = datetime.now(timezone.utc)

        message_id = str(payload.get("message_id") or "")
        is_new = True
        if message_id:
            inserted = await db.scalar(
                insert(ProcessedMessage)
                .values(workspace_id=ws.id, message_id=message_id)
                .on_conflict_do_nothing()
                .returning(ProcessedMessage.id)
            )
            is_new = inserted is not None
        await db.commit()

    if not ws.is_active:
        return {"status": "ignored", "reason": "workspace paused"}
    if not is_new:
        return {"status": "ignored", "reason": "duplicate"}
    if str(payload.get("direction") or "inbound").lower() != "inbound":
        return {"status": "ignored", "reason": "outbound"}

    background.add_task(conversation.handle, ws.id, payload)
    return {"status": "ok"}
