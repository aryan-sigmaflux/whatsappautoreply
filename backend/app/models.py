import secrets
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def new_webhook_token() -> str:
    return secrets.token_urlsafe(24)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Workspace(Base):
    """One connected GetGabs account. Its webhook token routes incoming messages to it."""

    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    webhook_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, default=new_webhook_token)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_webhook_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Trigger(Base):
    __tablename__ = "triggers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    # equals | contains | any
    match_type: Mapped[str] = mapped_column(String(16))
    keywords: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    # Only fire for messages whose referral source contains this (e.g. "facebook").
    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # text | file | quick_reply | cta_url | list | location | flow
    response_type: Mapped[str] = mapped_column(String(32))
    response: Mapped[dict] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id], lazy="joined")
    updated_by: Mapped[User | None] = relationship(foreign_keys=[updated_by_id], lazy="joined")


class Flow(Base):
    """A conversation graph started by a trigger whose response_type is "flow".

    graph = {"nodes": [{id, type, position, data}], "edges": [{id, source, sourceHandle, target}]},
    the same shape React Flow uses. See app/services/flows.py for node types.
    """

    __tablename__ = "flows"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # active | draft — draft flows never run for customers.
    status: Mapped[str] = mapped_column(String(16), default="draft")
    graph: Mapped[dict] = mapped_column(JSONB)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id], lazy="joined")
    updated_by: Mapped[User | None] = relationship(foreign_keys=[updated_by_id], lazy="joined")


class Chat(Base):
    """One contact's conversation, shown in the Chats tab. Created the first time a flow runs
    for the contact; after that every message to and from them is kept in ChatMessage."""

    __tablename__ = "chats"
    __table_args__ = (UniqueConstraint("workspace_id", "contact"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    contact: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(255), default="")
    # The 24-hour window for sending by hand runs from the contact's last message.
    last_inbound_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    last_preview: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    # in = from the contact, out = sent by us
    direction: Mapped[str] = mapped_column(String(8))
    # in: text | button | media; out: a reply type (text, file, quick_reply, ...)
    kind: Mapped[str] = mapped_column(String(32))
    # in: {"text", "message_type"}; out: the response with {{name}} filled in
    content: Mapped[dict] = mapped_column(JSONB)
    # out only: "Flow: <name>", "Trigger: <name>" or the team member who sent it by hand
    sent_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class FlowSession(Base):
    """Where a contact is in a flow: the node waiting for their reply.

    node_id is "" once the flow's path has finished; the row is kept until it expires so a
    tap on an older message of the flow still continues it."""

    __tablename__ = "flow_sessions"
    __table_args__ = (UniqueConstraint("workspace_id", "contact"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE")
    )
    contact: Mapped[str] = mapped_column(String(32))
    flow_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("flows.id", ondelete="CASCADE"))
    node_id: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProcessedMessage(Base):
    """Seen inbound message ids, so a GetGabs retry never sends a second reply."""

    __tablename__ = "processed_messages"
    __table_args__ = (UniqueConstraint("workspace_id", "message_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE")
    )
    message_id: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
