"""
Inbound webhook. Each workspace gets its own URL, /webhook/{token}, which is
pasted into that GetGabs account — the token is how we tell accounts apart,
since GetGabs payloads carry no account id or signature.

GetGabs treats anything but a quick 200 as a failure and retries, so we
acknowledge immediately, de-duplicate on message_id, and reply in the background
(app/services/conversation.py decides what to send).

Every request, including retries and outbound echoes, is also stored in webhook_logs
for the Logs tab; the background task fills in its result.
"""

import json
from datetime import datetime, timezone
from urllib.parse import parse_qs

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import ProcessedMessage, WebhookLog, Workspace
from app.services import conversation
from app.services.matcher import extract_text

router = APIRouter(tags=["webhook"])

_RAW_LIMIT = 100_000  # characters of an unreadable body kept in the log


def _strip_nul(value):
    """Postgres can't store NUL characters in text or JSONB."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [_strip_nul(v) for v in value]
    if isinstance(value, dict):
        return {_strip_nul(k): _strip_nul(v) for k, v in value.items()}
    return value


async def _read_payload(request: Request) -> tuple[dict, bool]:
    """The parsed body, and whether it could be read at all."""
    payload, readable = _parse(await request.body())
    return _strip_nul(payload), readable


def _parse(raw: bytes) -> tuple[dict, bool]:
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        text = raw.decode(errors="replace")
        data = {k: v[0] for k, v in parse_qs(text).items()}
        if not data and text.strip():
            return {"_raw": text[:_RAW_LIMIT]}, False
    if not isinstance(data, dict):
        return {"_raw": raw.decode(errors="replace")[:_RAW_LIMIT]}, False
    return data, True


def _contact(payload: dict) -> str:
    return "".join(ch for ch in str(payload.get("message_from") or payload.get("profile_wa_id") or "") if ch.isdigit())


@router.post("/webhook/{token}")
async def receive(token: str, request: Request, background: BackgroundTasks):
    payload, readable = await _read_payload(request)

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

        inbound = str(payload.get("direction") or "inbound").lower() == "inbound"
        if not readable:
            state, result = "unreadable", "Ignored: the body was not JSON or a form"
        elif not is_new:
            state, result = "duplicate", "Ignored: a retry of a message already handled"
        elif not inbound:
            state, result = "outbound", "Ignored: a message sent from this number, not by a customer"
        elif not ws.is_active:
            state, result = "paused", "Not replied: this account is paused"
        else:
            state, result = "received", None
        log = WebhookLog(
            workspace_id=ws.id,
            contact=_contact(payload)[:32],
            name=str(payload.get("profile_name") or "").strip()[:255],
            message_type=str(payload.get("message_type") or "")[:64],
            text=extract_text(payload),
            payload=payload,
            status=state,
            result=result,
        )
        db.add(log)
        await db.flush()
        log_id = log.id
        await db.commit()

    if state == "unreadable":
        return {"status": "ignored", "reason": "unreadable"}
    if state == "duplicate":
        return {"status": "ignored", "reason": "duplicate"}
    if state == "outbound":
        return {"status": "ignored", "reason": "outbound"}
    if state == "paused":
        background.add_task(conversation.record, ws.id, payload)  # Chats tab only, no reply
        return {"status": "ignored", "reason": "workspace paused"}

    background.add_task(conversation.handle, ws.id, payload, log_id)
    return {"status": "ok"}
