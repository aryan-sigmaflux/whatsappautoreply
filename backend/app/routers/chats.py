"""Chats tab: conversations with contacts who entered a flow, and sending a message by hand
while the contact's 24-hour window is open."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user, workspace_or_404
from app.models import Chat, ChatMessage, User, Workspace
from app.schemas import ChatDetailOut, ChatMessageOut, ChatOut, ChatSendIn
from app.security import decrypt
from app.services import chats, getgabs

router = APIRouter(prefix="/api/workspaces/{workspace_id}/chats", tags=["chats"])

_MESSAGES = 500  # the most recent messages shown for one chat


def _out(chat: Chat) -> ChatOut:
    out = ChatOut.model_validate(chat)
    out.window_open = chats.window_open(chat)
    out.window_closes_at = chats.window_closes_at(chat)
    return out


async def _get(db: AsyncSession, ws: Workspace, chat_id: int) -> Chat:
    chat = await db.get(Chat, chat_id)
    if not chat or chat.workspace_id != ws.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat not found")
    return chat


@router.get("", response_model=list[ChatOut])
async def list_chats(
    q: str = Query(default="", max_length=100),
    ws: Workspace = Depends(workspace_or_404),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Chat).where(Chat.workspace_id == ws.id)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Chat.name.ilike(like), Chat.contact.ilike(like)))
    rows = await db.scalars(stmt.order_by(Chat.last_message_at.desc()).limit(300))
    return [_out(c) for c in rows]


@router.get("/{chat_id}", response_model=ChatDetailOut)
async def get_chat(chat_id: int, ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    chat = await _get(db, ws, chat_id)
    rows = list(
        await db.scalars(
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat.id)
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(_MESSAGES)
        )
    )
    return ChatDetailOut(chat=_out(chat), messages=list(reversed(rows)))


@router.post("/{chat_id}/messages", response_model=ChatMessageOut, status_code=status.HTTP_201_CREATED)
async def send_message(
    chat_id: int,
    body: ChatSendIn,
    ws: Workspace = Depends(workspace_or_404),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    chat = await _get(db, ws, chat_id)
    if not chats.window_open(chat):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The 24-hour window is closed. WhatsApp only allows a reply after the contact messages again.",
        )
    key = decrypt(ws.api_key_encrypted) if ws.api_key_encrypted else None
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add the GetGabs API key in Setup first")
    try:
        await getgabs.send(key, chat.contact, getgabs.build_message(body.response_type, body.response))
    except getgabs.GetGabsError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    msg = chats.add(db, chat, "out", body.response_type, body.response, sent_by=user.name)
    await db.commit()
    await db.refresh(msg)
    return msg
