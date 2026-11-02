"""
The Chats tab's message log.

A contact gets a Chat the first time a flow runs for them. From then on every message they
send, and every message we send them (flows, triggers, or typed by hand in the Chats tab),
is stored as a ChatMessage. Contacts who never entered a flow are not logged.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chat, ChatMessage
from app.services.matcher import Tap

WINDOW = timedelta(hours=24)  # WhatsApp's customer service window
_MEDIA = ("image", "video", "audio", "document", "sticker")


def fill(value, name: str):
    """The response with {{name}} replaced, as the contact saw it."""
    if isinstance(value, str):
        return value.replace("{{name}}", name)
    if isinstance(value, list):
        return [fill(v, name) for v in value]
    if isinstance(value, dict):
        return {k: fill(v, name) for k, v in value.items()}
    return value


def window_closes_at(chat: Chat) -> datetime | None:
    return chat.last_inbound_at + WINDOW if chat.last_inbound_at else None


def window_open(chat: Chat) -> bool:
    closes = window_closes_at(chat)
    return bool(closes and closes > datetime.now(timezone.utc))


def _preview(direction: str, kind: str, content: dict) -> str:
    if direction == "in":
        text = content.get("text") or ""
        if kind == "media":
            text = f"[{content.get('message_type') or 'media'}]"
    else:
        text = (
            content.get("body")
            or content.get("caption")
            or {"file": "[file]", "location": "[location]"}.get(kind, "")
        )
    text = " ".join(str(text).split())
    return text[:250]


async def get(db: AsyncSession, workspace_id: uuid.UUID, contact: str) -> Chat | None:
    return await db.scalar(select(Chat).where(Chat.workspace_id == workspace_id, Chat.contact == contact))


async def get_or_create(db: AsyncSession, workspace_id: uuid.UUID, contact: str, name: str) -> Chat:
    await db.execute(
        insert(Chat).values(workspace_id=workspace_id, contact=contact, name=name).on_conflict_do_nothing()
    )
    return await get(db, workspace_id, contact)


def inbound_content(payload: dict, text: str, tap: Tap | None) -> tuple[str, dict]:
    message_type = str(payload.get("message_type") or "text").lower()
    if message_type in _MEDIA:
        return "media", {"message_type": message_type, "url": str(payload.get("message_text") or "")}
    if tap:
        return "button", {"text": tap.title or text}
    return "text", {"text": text}


def add(
    db: AsyncSession,
    chat: Chat,
    direction: str,
    kind: str,
    content: dict,
    *,
    sent_by: str | None = None,
    error: str | None = None,
    name: str = "",
) -> ChatMessage:
    now = datetime.now(timezone.utc)
    msg = ChatMessage(
        chat_id=chat.id, direction=direction, kind=kind, content=content, sent_by=sent_by, error=error, created_at=now
    )
    db.add(msg)
    chat.last_message_at = now
    chat.last_preview = _preview(direction, kind, content)
    if direction == "in":
        chat.last_inbound_at = now
        if name:
            chat.name = name[:255]
    return msg
