"""
Picks the one trigger that answers an inbound message.

Priority, highest first (same as GetGabs):
  1. Equals   — the whole message equals a keyword
  2. Contains — the message contains a keyword (longest keyword wins)
  3. Any      — fallback for every message
Within a level, a trigger restricted to the message's source beats an
unrestricted one, and the oldest trigger breaks any remaining tie.
Matching ignores case and repeated whitespace.
"""

import json
from dataclasses import dataclass

from app.models import Trigger

_LEVEL = {"equals": 0, "contains": 1, "any": 2}


@dataclass
class Match:
    trigger: Trigger
    keyword: str | None
    reason: str


def normalize(text: str) -> str:
    return " ".join(text.casefold().split())


def extract_text(payload: dict) -> str:
    """The text to match against. Button and list taps arrive as a JSON string
    in message_text; their visible title is what we match on."""
    raw = payload.get("message_text")
    if not isinstance(raw, str):
        return ""
    message_type = str(payload.get("message_type") or "").lower()
    if message_type in ("image", "video", "audio", "document", "sticker"):
        return ""  # message_text is the media URL
    if message_type not in ("button", "interactive") and not raw.lstrip().startswith("{"):
        return raw
    try:
        data = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(data, dict):
        return raw
    interactive = data.get("interactive") or {}
    for candidate in (
        (data.get("button") or {}).get("text"),
        (data.get("button") or {}).get("payload"),
        (interactive.get("button_reply") or {}).get("title"),
        (interactive.get("list_reply") or {}).get("title"),
        (data.get("button_reply") or {}).get("title"),
        (data.get("list_reply") or {}).get("title"),
        data.get("text") if isinstance(data.get("text"), str) else (data.get("text") or {}).get("body"),
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate
    return raw


def find_match(triggers: list[Trigger], text: str, source: str | None) -> Match | None:
    message = normalize(text)
    source_norm = normalize(source or "")
    best: tuple[tuple, Match] | None = None

    for t in triggers:
        if not t.is_active:
            continue
        if t.source:
            if not source_norm or normalize(t.source) not in source_norm:
                continue

        keyword = None
        if t.match_type == "equals":
            keyword = next((k for k in t.keywords if normalize(k) == message and message), None)
            if keyword is None:
                continue
            reason = f'Message equals "{keyword}"'
            kw_len = 0
        elif t.match_type == "contains":
            hits = [k for k in t.keywords if normalize(k) and normalize(k) in message]
            if not hits:
                continue
            keyword = max(hits, key=lambda k: len(normalize(k)))
            reason = f'Message contains "{keyword}"'
            kw_len = len(normalize(keyword))
        elif t.match_type == "any":
            reason = "Any message (no keyword matched)"
            kw_len = 0
        else:
            continue

        if t.source:
            reason += f' · source "{t.source}"'
        rank = (_LEVEL[t.match_type], 0 if t.source else 1, -kw_len, t.created_at)
        if best is None or rank < best[0]:
            best = (rank, Match(t, keyword, reason))

    return best[1] if best else None
