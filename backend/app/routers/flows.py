import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user, workspace_or_404
from app.models import Flow, Trigger, User, Workspace
from app.schemas import (
    FlowCreateIn,
    FlowIn,
    FlowOut,
    FlowSummaryOut,
    FlowTriggerRef,
    SimulateIn,
    SimulateOut,
)
from app.services import flows as engine

router = APIRouter(prefix="/api/workspaces/{workspace_id}/flows", tags=["flows"])


async def _triggers_by_flow(db: AsyncSession, ws: Workspace) -> dict[str, list[Trigger]]:
    rows = await db.scalars(
        select(Trigger).where(Trigger.workspace_id == ws.id, Trigger.response_type == "flow")
    )
    out: dict[str, list[Trigger]] = {}
    for t in rows:
        out.setdefault(str(t.response.get("flow_id")), []).append(t)
    return out


def _summary(f: Flow, triggers: list[Trigger]) -> dict:
    return dict(
        id=f.id,
        name=f.name,
        description=f.description,
        status=f.status,
        node_count=sum(1 for n in f.graph.get("nodes", []) if n.get("type") != "start"),
        triggers=[FlowTriggerRef.model_validate(t) for t in triggers],
        created_at=f.created_at,
        updated_at=f.updated_at,
        created_by=f.created_by,
        updated_by=f.updated_by,
    )


async def _get(db: AsyncSession, ws: Workspace, flow_id: uuid.UUID) -> Flow:
    f = await db.get(Flow, flow_id)
    if not f or f.workspace_id != ws.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flow not found")
    return f


async def _out(db: AsyncSession, ws: Workspace, flow_id: uuid.UUID) -> FlowOut:
    f = await db.get(Flow, flow_id, populate_existing=True)
    triggers = (await _triggers_by_flow(db, ws)).get(str(f.id), [])
    return FlowOut(**_summary(f, triggers), graph=f.graph)


@router.get("", response_model=list[FlowSummaryOut])
async def list_flows(ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(Flow).where(Flow.workspace_id == ws.id).order_by(Flow.updated_at.desc()))
    by_flow = await _triggers_by_flow(db, ws)
    return [FlowSummaryOut(**_summary(f, by_flow.get(str(f.id), []))) for f in rows]


@router.post("", response_model=FlowOut, status_code=status.HTTP_201_CREATED)
async def create_flow(
    body: FlowCreateIn,
    ws: Workspace = Depends(workspace_or_404),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    f = Flow(
        workspace_id=ws.id,
        name=body.name.strip(),
        description=(body.description or "").strip() or None,
        status="draft",
        graph=engine.new_graph(),
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(f)
    await db.commit()
    return await _out(db, ws, f.id)


@router.get("/{flow_id}", response_model=FlowOut)
async def get_flow(flow_id: uuid.UUID, ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    await _get(db, ws, flow_id)
    return await _out(db, ws, flow_id)


@router.put("/{flow_id}", response_model=FlowOut)
async def save_flow(
    flow_id: uuid.UUID,
    body: FlowIn,
    ws: Workspace = Depends(workspace_or_404),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Drafts may be incomplete; saving as Active checks every step."""
    f = await _get(db, ws, flow_id)
    try:
        graph = engine.clean_graph(body.graph, strict=body.status == "active")
    except engine.FlowInvalid as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    f.name = body.name.strip()
    f.description = (body.description or "").strip() or None
    f.status = body.status
    f.graph = graph
    f.updated_by_id = user.id
    await db.commit()
    return await _out(db, ws, f.id)


@router.post("/{flow_id}/duplicate", response_model=FlowOut, status_code=status.HTTP_201_CREATED)
async def duplicate_flow(
    flow_id: uuid.UUID,
    ws: Workspace = Depends(workspace_or_404),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    src = await _get(db, ws, flow_id)
    f = Flow(
        workspace_id=ws.id,
        name=f"{src.name} (copy)"[:255],
        description=src.description,
        status="draft",
        graph=src.graph,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(f)
    await db.commit()
    return await _out(db, ws, f.id)


@router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flow(flow_id: uuid.UUID, ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    f = await _get(db, ws, flow_id)
    used = (await _triggers_by_flow(db, ws)).get(str(f.id), [])
    if used:
        names = ", ".join(t.name for t in used[:5])
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Used by {len(used)} keyword trigger{'s' if len(used) > 1 else ''} ({names}). Change or delete them first.",
        )
    await db.delete(f)
    await db.commit()


@router.post("/{flow_id}/simulate", response_model=SimulateOut)
async def simulate(flow_id: uuid.UUID, body: SimulateIn, ws: Workspace = Depends(workspace_or_404), db: AsyncSession = Depends(get_db)):
    """Run the (possibly unsaved) graph for the builder's Test panel. Nothing is sent."""
    await _get(db, ws, flow_id)
    try:
        graph = engine.clean_graph(body.graph, strict=False)
    except engine.FlowInvalid as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    if body.waiting_node_id is None:
        step = engine.start(graph)
        note = None if step.outputs or step.waiting else "The Trigger isn't connected to anything yet."
        return SimulateOut(outputs=step.outputs, waiting_node_id=step.waiting, note=note)

    node = next((n for n in graph["nodes"] if n["id"] == body.waiting_node_id), None)
    if not node:
        return SimulateOut(outputs=[], waiting_node_id=None, note="That step no longer exists. Restart the test.")

    option = engine.choose(node, body.message)
    handle = option or "default"
    target = engine.next_target(graph, node["id"], handle)
    if not target:
        if option:
            return SimulateOut(outputs=[], waiting_node_id=None, note="That option isn't connected to anything, so the flow ends here.")
        return SimulateOut(
            outputs=[],
            waiting_node_id=node["id"],
            note="No option matched and there's no default path. In a real chat this message goes to your "
            "keyword triggers, and the flow keeps waiting here.",
        )
    step = engine.run(graph, target)
    note = None if option else "No option matched, so the default path was used."
    if not step.waiting:
        note = (note + " " if note else "") + "The flow ends here."
    return SimulateOut(outputs=step.outputs, waiting_node_id=step.waiting, note=note)
