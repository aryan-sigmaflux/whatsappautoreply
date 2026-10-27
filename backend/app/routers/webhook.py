"""
Inbound webhook. Each workspace gets its own URL, /webhook/{token}, which is
pasted into that GetGabs account — the token is how we tell accounts apart,
since GetGabs payloads carry no account id or signature.

GetGabs treats anything but a quick 200 as a failure and retries, so we
acknowledge immediately, de-duplicate on message_id, and reply in the background.
"""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import ProcessedMessage, Trigger, Workspace
from app.security import decrypt
from app.services import getgabs
from app.services.matcher import extract_text, find_match

log = logging.getLogger(__name__)

router = APIRouter(tags=["webhook"])

_DEDUPE_DAYS = 7


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

    background.add_task(_reply, ws.id, payload)
    return {"status": "ok"}


async def _reply(workspace_id: uuid.UUID, payload: dict) -> None:
    to = "".join(ch for ch in str(payload.get("message_from") or payload.get("profile_wa_id") or "") if ch.isdigit())
    if not to:
        return

    async with SessionLocal() as db:
        ws = await db.get(Workspace, workspace_id)
        triggers = list(await db.scalars(select(Trigger).where(Trigger.workspace_id == workspace_id)))
        await db.execute(
            delete(ProcessedMessage).where(
                ProcessedMessage.created_at < datetime.now(timezone.utc) - timedelta(days=_DEDUPE_DAYS)
            )
        )
        await db.commit()

    text = extract_text(payload)
    match = find_match(triggers, text, payload.get("referral_source_domain"))
    if not match:
        return

    api_key = decrypt(ws.api_key_encrypted) if ws and ws.api_key_encrypted else None
    if not api_key:
        log.warning("Workspace %s matched trigger %s but has no API key", workspace_id, match.trigger.id)
        return

    name = str(payload.get("profile_name") or "").strip()
    try:
        message = getgabs.build_message(match.trigger.response_type, match.trigger.response, name)
        await getgabs.send(api_key, to, message)
        log.info("Workspace %s: '%s' replied to %s (%s)", workspace_id, match.trigger.name, to, match.reason)
    except Exception:
        log.exception("Workspace %s: sending trigger %s to %s failed", workspace_id, match.trigger.id, to)
