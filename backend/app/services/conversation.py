"""
What to send for one inbound message. Order of precedence:

  1. The reply picks a flow option → follow that path. Either:
     - the contact is mid-flow and it picks one of the waiting step's options, or
     - it is a tap on a button/row of an older flow message (the contact scrolled back up),
       found by the option id WhatsApp sends back or, without one, by a title that is unique
       in the contact's flow. This works after the flow finished too, while it is Active.
       An older option with nothing connected does nothing and falls through to step 2.
  2. Otherwise an Equals keyword trigger matches → it wins, even mid-flow (lets "hi" restart).
  3. Mid-flow and the waiting step has a "default" path → follow it (not for older-message taps).
  4. Otherwise the normal keyword triggers (Equals > Contains > Any).
     If none fires the contact stays where they were in the flow, so a later tap still works.

A trigger whose response_type is "flow" starts that flow; any other trigger sends one
message and forgets whatever flow the contact was in. When a flow's path finishes, the
session is kept with node_id "" so older taps still work until it expires.

Once a flow has run for a contact, their messages are also logged for the Chats tab
(app/services/chats.py).
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import Chat, Flow, FlowSession, ProcessedMessage, Trigger, Workspace
from app.security import decrypt
from app.services import chats, flows, getgabs
from app.services.matcher import extract_tap, extract_text, find_match

log = logging.getLogger(__name__)

SESSION_HOURS = 24  # WhatsApp's reply window
_DEDUPE_DAYS = 7
_KEEP = object()  # leave the contact's flow position unchanged


async def handle(workspace_id: uuid.UUID, payload: dict) -> None:
    to = "".join(ch for ch in str(payload.get("message_from") or payload.get("profile_wa_id") or "") if ch.isdigit())
    if not to:
        return
    text = extract_text(payload)
    tap = extract_tap(payload)
    source = payload.get("referral_source_domain")
    name = str(payload.get("profile_name") or "").strip()
    now = datetime.now(timezone.utc)

    async with SessionLocal() as db:
        ws = await db.get(Workspace, workspace_id)
        api_key = decrypt(ws.api_key_encrypted) if ws and ws.api_key_encrypted else None
        if not api_key:
            log.warning("Workspace %s got a message but has no API key", workspace_id)
            return

        await db.execute(delete(FlowSession).where(FlowSession.expires_at < now))
        await db.execute(
            delete(ProcessedMessage).where(ProcessedMessage.created_at < now - timedelta(days=_DEDUPE_DAYS))
        )
        triggers = list(await db.scalars(select(Trigger).where(Trigger.workspace_id == workspace_id)))
        session = await db.scalar(
            select(FlowSession).where(FlowSession.workspace_id == workspace_id, FlowSession.contact == to)
        )

        outputs: list[dict] = []
        # (flow_id, node_id) — node_id "" when the flow finished but old taps should still work —
        # None to forget the flow, or _KEEP
        position = _KEEP
        reason = ""
        sent_by = None  # shown on the outgoing messages in the Chats tab

        flow = await db.get(Flow, session.flow_id) if session else None
        if session and (not flow or flow.status != "active"):
            position, flow = None, None
        node = next((n for n in flow.graph["nodes"] if n["id"] == session.node_id), None) if flow else None
        waiting_id = node["id"] if node else None

        # Which flow option this message picks: (flow, node id, option id).
        picked = None
        if tap and tap.option_id:
            # The id of the tapped button/row points at the exact message, however old.
            if flow and (hit := flows.option_by_id(flow.graph, tap.option_id)):
                picked = (flow, *hit)
            else:
                others = await db.scalars(
                    select(Flow).where(Flow.workspace_id == workspace_id, Flow.status == "active")
                )
                for f in others:
                    if hit := flows.option_by_id(f.graph, tap.option_id):
                        picked = (f, *hit)
                        break
        if not picked and node and (option := flows.choose(node, text)):
            picked = (flow, waiting_id, option)
        if not picked and tap and flow:
            # A tap without an id on an older message of this flow, if its title is unique there.
            if hit := flows.option_by_title(flow.graph, tap.title, skip=waiting_id):
                picked = (flow, *hit)

        handled = False
        if picked:
            f, node_id, option = picked
            target = flows.next_target(f.graph, node_id, option)
            # An unconnected option ends the flow when tapped on the waiting step; on an older
            # message it does nothing, and the message goes to the keyword triggers instead.
            if target or node_id == waiting_id:
                step = flows.run(f.graph, target)
                outputs, position = step.outputs, (f.id, step.waiting or "")
                earlier = "" if node_id == waiting_id else " (earlier message)"
                reason, handled = f"flow '{f.name}' option {option}{earlier}", True
                sent_by = f"Flow: {f.name}"

        if not handled:
            match = find_match([t for t in triggers if t.match_type == "equals"], text, source)
            if not match and node and not picked:
                target = flows.next_target(flow.graph, node["id"], "default")
                if target:
                    step = flows.run(flow.graph, target)
                    outputs, position = step.outputs, (flow.id, step.waiting or "")
                    reason, handled = f"flow '{flow.name}' default path", True
                    sent_by = f"Flow: {flow.name}"
            if not handled:
                match = match or find_match(triggers, text, source)
                if match:
                    t = match.trigger
                    reason = f"trigger '{t.name}' ({match.reason})"
                    sent_by = f"Trigger: {t.name}"
                    if t.response_type == "flow":
                        target_flow = await db.get(Flow, uuid.UUID(t.response["flow_id"]))
                        if target_flow and target_flow.workspace_id == workspace_id and target_flow.status == "active":
                            step = flows.start(target_flow.graph)
                            outputs = step.outputs
                            position = (target_flow.id, step.waiting or "")
                            sent_by = f"Flow: {target_flow.name}"
                        else:
                            log.warning("Trigger %s points at a missing or draft flow", t.id)
                    else:
                        outputs = [{"node_id": None, "response_type": t.response_type, "response": t.response}]
                        position = None

        if position is None and session:
            await db.delete(session)
        elif position is not _KEEP and position is not None:
            flow_id, node_id = position
            await db.execute(
                insert(FlowSession)
                .values(workspace_id=workspace_id, contact=to, flow_id=flow_id, node_id=node_id,
                        expires_at=now + timedelta(hours=SESSION_HOURS))
                .on_conflict_do_update(
                    index_elements=["workspace_id", "contact"],
                    set_={"flow_id": flow_id, "node_id": node_id,
                          "expires_at": now + timedelta(hours=SESSION_HOURS), "updated_at": now},
                )
            )

        # Chats tab: a flow running for the contact starts their chat; after that, log everything.
        chat = await chats.get(db, workspace_id, to)
        if not chat and isinstance(position, tuple):
            chat = await chats.get_or_create(db, workspace_id, to, name)
        if chat:
            kind, content = chats.inbound_content(payload, text, tap)
            chats.add(db, chat, "in", kind, content, name=name)
        chat_id = chat.id if chat else None
        await db.commit()

    sent: list[tuple[dict, str | None]] = []  # (output, error)
    for out in outputs:
        try:
            message = getgabs.build_message(out["response_type"], out["response"], name)
            await getgabs.send(api_key, to, message)
            sent.append((out, None))
        except Exception as e:
            log.exception("Workspace %s: sending to %s failed (%s)", workspace_id, to, reason)
            sent.append((out, str(e)[:1000] or "Sending failed"))
            break
    if outputs and not sent[-1][1]:
        log.info("Workspace %s: replied to %s with %d message(s) — %s", workspace_id, to, len(outputs), reason)

    if chat_id and sent:
        async with SessionLocal() as db:
            chat = await db.get(Chat, chat_id)
            if chat:
                for out, error in sent:
                    content = chats.fill(out["response"], name)
                    chats.add(db, chat, "out", out["response_type"], content, sent_by=sent_by, error=error)
                await db.commit()


async def record(workspace_id: uuid.UUID, payload: dict) -> None:
    """A message for a paused workspace: nothing is sent, but an existing chat still logs it,
    so the Chats tab shows it and its 24-hour window stays right."""
    to = "".join(ch for ch in str(payload.get("message_from") or payload.get("profile_wa_id") or "") if ch.isdigit())
    if not to:
        return
    async with SessionLocal() as db:
        chat = await chats.get(db, workspace_id, to)
        if chat:
            kind, content = chats.inbound_content(payload, extract_text(payload), extract_tap(payload))
            chats.add(db, chat, "in", kind, content, name=str(payload.get("profile_name") or "").strip())
            await db.commit()
