"""
GetGabs send API: builds service-message payloads from stored trigger responses.

Docs: https://documenter.getpostman.com/view/40451098/2sAYJ1k2VV
All service messages go to POST /sendservicemessages/sendmessages with the
account's api_key in the JSON body.
"""

import logging

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

_client = httpx.AsyncClient(timeout=httpx.Timeout(20.0))


class GetGabsError(Exception):
    pass


def _fill(text: str | None, name: str) -> str | None:
    if text is None:
        return None
    return text.replace("{{name}}", name).strip() or None


def _header(header: dict | None, name: str) -> dict | None:
    if not header or header.get("type", "none") == "none":
        return None
    kind = header["type"]
    if kind == "text":
        return {"type": "text", "text": _fill(header.get("text"), name)}
    media = {"link": header["url"]}
    if kind == "document" and header.get("filename"):
        media["filename"] = header["filename"]
    return {"type": kind, kind: media}


def build_message(response_type: str, response: dict, name: str = "") -> dict:
    """The type-specific part of a send payload (everything except to/api_key)."""
    r = response

    if response_type == "text":
        return {"type": "text", "text": {"body": _fill(r["body"], name), "preview_url": True}}

    if response_type == "file":
        kind = r["media_type"]
        media: dict = {"link": r["url"]}
        if kind != "audio" and _fill(r.get("caption"), name):
            media["caption"] = _fill(r.get("caption"), name)
        if kind == "document":
            media["filename"] = r.get("filename") or "document"
        return {"type": kind, kind: media}

    if response_type == "location":
        loc = {"latitude": str(r["latitude"]), "longitude": str(r["longitude"])}
        for field in ("name", "address"):
            if r.get(field):
                loc[field] = r[field]
        return {"type": "location", "location": loc}

    interactive: dict = {"body": {"text": _fill(r["body"], name)}}
    if _fill(r.get("footer"), name):
        interactive["footer"] = {"text": _fill(r["footer"], name)}

    if response_type == "quick_reply":
        interactive["type"] = "button"
        interactive["action"] = {
            "buttons": [{"type": "reply", "reply": {"id": b["id"], "title": b["title"]}} for b in r["buttons"]]
        }
        if header := _header(r.get("header"), name):
            interactive["header"] = header
    elif response_type == "cta_url":
        interactive["type"] = "cta_url"
        interactive["action"] = {
            "name": "cta_url",
            "parameters": {"display_text": r["display_text"], "url": r["url"]},
        }
        if header := _header(r.get("header"), name):
            interactive["header"] = header
    elif response_type == "list":
        interactive["type"] = "list"
        interactive["action"] = {
            "button": r["button_text"],
            "sections": [
                {
                    "title": s["title"],
                    "rows": [
                        {k: row[k] for k in ("id", "title", "description") if row.get(k)} for row in s["rows"]
                    ],
                }
                for s in r["sections"]
            ],
        }
        if _fill(r.get("header_text"), name):
            interactive["header"] = {"type": "text", "text": _fill(r["header_text"], name)}
    else:
        raise ValueError(f"Unknown response type {response_type!r}")

    return {"type": "interactive", "interactive": interactive}


async def send(api_key: str, to: str, message: dict) -> dict:
    payload = {
        "to": to,
        "recipient_type": "individual",
        "messaging_product": "whatsapp",
        "api_key": api_key,
        **message,
    }
    url = f"{get_settings().getgabs_base_url}/sendservicemessages/sendmessages"
    try:
        res = await _client.post(url, json=payload)
    except httpx.HTTPError as e:
        raise GetGabsError(f"Could not reach GetGabs: {e}") from e
    try:
        body = res.json()
    except ValueError:
        body = {"raw": res.text[:500]}
    if res.status_code >= 400 or not isinstance(body, dict) or not body.get("messages"):
        raise GetGabsError(f"GetGabs rejected the message (HTTP {res.status_code}): {str(body)[:500]}")
    return body
