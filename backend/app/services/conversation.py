"""
What to send for one inbound message. Order of precedence:

  1. The contact is mid-flow and the reply picks one of the waiting step's options → follow it.
  2. Otherwise an Equals keyword trigger matches → it wins, even mid-flow (lets "hi" restart).
  3. Mid-flow and the waiting step has a "default" path → follow it.
  4. Otherwise the normal keyword triggers (Equals > Contains > Any).
     If none fires the contact stays where they were in the flow, so a later tap still works.

A trigger whose response_type is "flow" starts that flow; any other trigger sends one
message and ends whatever flow the contact was in.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import Flow, FlowSession, ProcessedMessage, Trigger, Workspace
from app.security import decrypt
from app.services import flows, getgabs
from app.services.matcher import extract_text, find_match

log = logging.getLogger(__name__)

SESSION_HOURS = 24  # WhatsApp's reply window
_DEDUPE_DAYS = 7
_KEEP = object()  # leave the contact's flow position unchanged


async def handle(workspace_id: uuid.UUID, payload: dict) -> None:
    to = "".join(ch for ch in str(payload.get("message_from") or payload.get("profile_wa_id") or "") if ch.isdigit())
    if not to:
        return
    text = extract_text(payload)
    source = payload.get("referral_source_domain")
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
        position = _KEEP  # (flow_id, node_id), None to end the flow, or _KEEP
        reason = ""

        flow = await db.get(Flow, session.flow_id) if session else None
        if session and (not flow or flow.status != "active"):
            position, flow = None, None
        node = next((n for n in flow.graph["nodes"] if n["id"] == session.node_id), None) if flow else None

        handled = False
        if node:
            option = flows.choose(node, text)
            if option:
                step = flows.run(flow.graph, flows.next_target(flow.graph, node["id"], option))
                outputs, position = step.outputs, (flow.id, step.waiting) if step.waiting else None
                reason, handled = f"flow '{flow.name}' option {option}", True

        if not handled:
            match = find_match([t for t in triggers if t.match_type == "equals"], text, source)
            if not match and node:
                target = flows.next_target(flow.graph, node["id"], "default")
                if target:
                    step = flows.run(flow.graph, target)
                    outputs, position = step.outputs, (flow.id, step.waiting) if step.waiting else None
                    reason, handled = f"flow '{flow.name}' default path", True
            if not handled:
                match = match or find_match(triggers, text, source)
                if match:
                    t = match.trigger
                    reason = f"trigger '{t.name}' ({match.reason})"
                    if t.response_type == "flow":
                        target_flow = await db.get(Flow, uuid.UUID(t.response["flow_id"]))
                        if target_flow and target_flow.workspace_id == workspace_id and target_flow.status == "active":
                            step = flows.start(target_flow.graph)
                            outputs = step.outputs
                            position = (target_flow.id, step.waiting) if step.waiting else None
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
        await db.commit()

    name = str(payload.get("profile_name") or "").strip()
    for out in outputs:
        try:
            message = getgabs.build_message(out["response_type"], out["response"], name)
            await getgabs.send(api_key, to, message)
        except Exception:
            log.exception("Workspace %s: sending to %s failed (%s)", workspace_id, to, reason)
            return
    if outputs:
        log.info("Workspace %s: replied to %s with %d message(s) — %s", workspace_id, to, len(outputs), reason)
