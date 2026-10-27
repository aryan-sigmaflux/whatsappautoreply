import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

# ── Auth ─────────────────────────────────────────────


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    name: str


class TokenOut(BaseModel):
    access_token: str
    user: UserOut


# ── Workspaces ───────────────────────────────────────


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # Omit (or null) to keep the stored key; empty string clears it.
    api_key: str | None = None
    is_active: bool = True


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    is_active: bool
    has_api_key: bool
    api_key_masked: str | None
    webhook_url: str
    last_webhook_at: datetime | None
    created_at: datetime


class TestSendIn(BaseModel):
    to: str = Field(min_length=6, max_length=20)
    text: str = Field(min_length=1, max_length=4096)


# ── Trigger responses ────────────────────────────────
# Limits follow WhatsApp's own; GetGabs passes these payloads straight through.

MediaType = Literal["image", "video", "audio", "document"]


class Header(BaseModel):
    type: Literal["none", "text", "image", "video", "document"] = "none"
    text: str | None = Field(default=None, max_length=60)
    url: str | None = None
    filename: str | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.type == "text" and not (self.text or "").strip():
            raise ValueError("Header text is required")
        if self.type in ("image", "video", "document") and not self.url:
            raise ValueError("Header media file is required")
        return self


class TextResponse(BaseModel):
    body: str = Field(min_length=1, max_length=4096)


class FileResponse(BaseModel):
    media_type: MediaType
    url: str = Field(min_length=1)
    filename: str | None = None
    caption: str | None = Field(default=None, max_length=1024)


class ReplyButton(BaseModel):
    id: str = Field(min_length=1, max_length=256)
    title: str = Field(min_length=1, max_length=20)


class QuickReplyResponse(BaseModel):
    header: Header = Header()
    body: str = Field(min_length=1, max_length=1024)
    footer: str | None = Field(default=None, max_length=60)
    buttons: list[ReplyButton] = Field(min_length=1, max_length=3)


class CtaUrlResponse(BaseModel):
    header: Header = Header()
    body: str = Field(min_length=1, max_length=1024)
    footer: str | None = Field(default=None, max_length=60)
    display_text: str = Field(min_length=1, max_length=20)
    url: str = Field(min_length=1)


class ListRow(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=24)
    description: str | None = Field(default=None, max_length=72)


class ListSection(BaseModel):
    title: str = Field(min_length=1, max_length=24)
    rows: list[ListRow] = Field(min_length=1)


class ListResponse(BaseModel):
    header_text: str | None = Field(default=None, max_length=60)
    body: str = Field(min_length=1, max_length=1024)
    footer: str | None = Field(default=None, max_length=60)
    button_text: str = Field(min_length=1, max_length=20)
    sections: list[ListSection] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def _check(self):
        if sum(len(s.rows) for s in self.sections) > 10:
            raise ValueError("A list can have at most 10 rows in total")
        return self


class LocationResponse(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    name: str | None = None
    address: str | None = None


RESPONSE_MODELS: dict[str, type[BaseModel]] = {
    "text": TextResponse,
    "file": FileResponse,
    "quick_reply": QuickReplyResponse,
    "cta_url": CtaUrlResponse,
    "list": ListResponse,
    "location": LocationResponse,
}

ResponseType = Literal["text", "file", "quick_reply", "cta_url", "list", "location"]
MatchType = Literal["equals", "contains", "any"]


# ── Triggers ─────────────────────────────────────────


class TriggerIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    match_type: MatchType
    keywords: list[str] = []
    source: str | None = Field(default=None, max_length=64)
    response_type: ResponseType
    response: dict
    is_active: bool = True

    @model_validator(mode="after")
    def _check(self):
        self.keywords = list(dict.fromkeys(k.strip() for k in self.keywords if k.strip()))
        if self.match_type == "any":
            self.keywords = []
        elif not self.keywords:
            raise ValueError("Add at least one keyword")
        self.source = (self.source or "").strip() or None
        # Normalise the payload through its model so only known fields are stored.
        self.response = RESPONSE_MODELS[self.response_type].model_validate(self.response).model_dump(
            exclude_none=True
        )
        return self


class TriggerStatusIn(BaseModel):
    is_active: bool


class BulkDeleteIn(BaseModel):
    ids: list[uuid.UUID]


class TriggerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    match_type: str
    keywords: list[str]
    source: str | None
    response_type: str
    response: dict
    is_active: bool
    created_at: datetime
    updated_at: datetime
    created_by: UserOut | None
    updated_by: UserOut | None


class TryMessageIn(BaseModel):
    message: str = Field(default="", max_length=4096)
    message_type: Literal["text", "button", "media"] = "text"
    source: str | None = None


class TryMessageOut(BaseModel):
    trigger: TriggerOut | None
    matched_keyword: str | None
    reason: str
