"""
Flow engine: walks a flow graph. Pure functions — no database, no sending — so the
webhook and the builder's Test panel run exactly the same logic.

Node types (node["data"] shape):
  start     {}                                         one per flow, output "next"
  send      {response_type, response}                  text | file | cta_url | location, output "next"
  buttons   {response: QuickReplyResponse}             waits; one output per button id + "default"
  list      {response: ListResponse}                   waits; one output per row id + "default"
  question  {body, cases: [{id, match_type, keywords}]} waits; one output per case id + "default"

Edges are React Flow edges; sourceHandle is the output name ("next", an option id or "default").
Sending nodes chain straight through to the next node; a waiting node sends its message
and stops until the contact replies. A node with nothing connected ends the flow.
"""

from dataclasses import dataclass, field

from pydantic import ValidationError

from app.schemas import RESPONSE_MODELS, FlowGraph, ListResponse, QuickReplyResponse
from app.services.matcher import normalize

WAITING = {"buttons", "list", "question"}
SEND_TYPES = {"text", "file", "cta_url", "location"}
# Stops a loop of sending nodes from messaging a customer forever.
MAX_STEPS = 25

_LABEL = {"start": "Trigger", "send": "Send Message", "buttons": "Quick Reply", "list": "Interactive List", "question": "Question"}
_SEND_LABEL = {"text": "Send Message", "file": "Media / File", "cta_url": "CTA URL Button", "location": "Location"}


@dataclass
class Step:
    outputs: list[dict] = field(default_factory=list)  # {node_id, response_type, response}
    waiting: str | None = None


def _buttons(node: dict) -> list[dict]:
    return ((node.get("data") or {}).get("response") or {}).get("buttons") or []


def _rows(node: dict) -> list[dict]:
    sections = ((node.get("data") or {}).get("response") or {}).get("sections") or []
    return [row for s in sections for row in (s.get("rows") or [])]


def _cases(node: dict) -> list[dict]:
    return (node.get("data") or {}).get("cases") or []


def handles(node: dict) -> list[str]:
    kind = node.get("type")
    if kind in ("start", "send"):
        return ["next"]
    if kind == "buttons":
        options = _buttons(node)
    elif kind == "list":
        options = _rows(node)
    elif kind == "question":
        options = _cases(node)
    else:
        return []
    return [o["id"] for o in options if o.get("id")] + ["default"]


def start_node(graph: dict) -> dict | None:
    return next((n for n in graph.get("nodes", []) if n.get("type") == "start"), None)


def next_target(graph: dict, node_id: str, handle: str) -> str | None:
    for e in graph.get("edges", []):
        if e.get("source") == node_id and (e.get("sourceHandle") or "next") == handle:
            return e.get("target")
    return None


def message_for(node: dict) -> tuple[str, dict] | None:
    data = node.get("data") or {}
    kind = node.get("type")
    if kind == "send" and data.get("response_type") in SEND_TYPES:
        return data["response_type"], data.get("response") or {}
    if kind == "buttons":
        return "quick_reply", data.get("response") or {}
    if kind == "list":
        return "list", data.get("response") or {}
    if kind == "question" and (data.get("body") or "").strip():
        return "text", {"body": data["body"]}
    return None


def run(graph: dict, node_id: str | None) -> Step:
    """Send from node_id onwards until a node waits for a reply or the path ends."""
    nodes = {n["id"]: n for n in graph.get("nodes", [])}
    step = Step()
    for _ in range(MAX_STEPS):
        node = nodes.get(node_id) if node_id else None
        if node is None:
            return step
        if msg := message_for(node):
            step.outputs.append({"node_id": node["id"], "response_type": msg[0], "response": msg[1]})
        if node["type"] in WAITING:
            step.waiting = node["id"]
            return step
        node_id = next_target(graph, node["id"], "next")
    return step


def start(graph: dict) -> Step:
    s = start_node(graph)
    return run(graph, next_target(graph, s["id"], "next")) if s else Step()


def choose(node: dict, text: str) -> str | None:
    """Which option of a waiting node this reply picks, if any."""
    message = normalize(text)
    if not message:
        return None
    kind = node.get("type")
    if kind in ("buttons", "list"):
        options = _buttons(node) if kind == "buttons" else _rows(node)
        for o in options:
            if normalize(o.get("title") or "") == message or o.get("id") == text.strip():
                return o["id"]
        return None
    if kind == "question":
        for case in _cases(node):
            keywords = [normalize(k) for k in case.get("keywords") or [] if normalize(k)]
            if case.get("match_type") == "contains":
                hit = any(k in message for k in keywords)
            else:
                hit = message in keywords
            if hit:
                return case["id"]
    return None


# ── Validation ─────────────────────────────────────


class FlowInvalid(ValueError):
    pass


def _describe(node: dict) -> str:
    data = node.get("data") or {}
    text = (data.get("response") or {}).get("body") or data.get("body") or ""
    text = " ".join(text.split())
    label = _SEND_LABEL.get(data.get("response_type"), _LABEL["send"]) if node["type"] == "send" else _LABEL.get(node["type"], node["type"])
    return f'{label} "{text[:30]}…"' if len(text) > 30 else f'{label} "{text}"' if text else label


def _first_error(e: ValidationError) -> str:
    err = e.errors()[0]
    where = ".".join(str(p) for p in err["loc"])
    return f"{err['msg'].removeprefix('Value error, ')}" + (f" ({where})" if where else "")


def clean_graph(graph: FlowGraph, strict: bool) -> dict:
    """Drop dangling edges and, when strict (saving as Active), check every node is complete.

    Raises FlowInvalid with a message naming the broken node.
    """
    nodes = [n.model_dump() for n in graph.nodes]
    ids = [n["id"] for n in nodes]
    if len(ids) != len(set(ids)):
        raise FlowInvalid("Two steps have the same id")
    if sum(1 for n in nodes if n["type"] == "start") != 1:
        raise FlowInvalid("A flow needs exactly one Trigger step")

    for node in nodes:
        data = node["data"] or {}
        if node["type"] == "send":
            rtype = data.get("response_type")
            if rtype not in SEND_TYPES:
                raise FlowInvalid(f"{_describe(node)}: pick a message type")
        if not strict:
            continue
        try:
            if node["type"] == "send":
                data["response"] = RESPONSE_MODELS[data["response_type"]].model_validate(
                    data.get("response") or {}
                ).model_dump(mode="json", exclude_none=True)
            elif node["type"] in ("buttons", "list"):
                model = QuickReplyResponse if node["type"] == "buttons" else ListResponse
                data["response"] = model.model_validate(data.get("response") or {}).model_dump(
                    mode="json", exclude_none=True
                )
                titles = [normalize(o["title"]) for o in (_buttons(node) if node["type"] == "buttons" else _rows(node))]
                if len(titles) != len(set(titles)):
                    raise FlowInvalid(f"{_describe(node)}: options need different titles")
            elif node["type"] == "question":
                if not (data.get("body") or "").strip():
                    raise FlowInvalid(f"{_describe(node)}: write the question")
                if len(data["body"]) > 4096:
                    raise FlowInvalid(f"{_describe(node)}: the question is longer than 4096 characters")
                for case in _cases(node):
                    case["keywords"] = [k.strip() for k in case.get("keywords") or [] if k.strip()]
                    if not case["keywords"]:
                        raise FlowInvalid(f"{_describe(node)}: every reply option needs a keyword")
        except ValidationError as e:
            raise FlowInvalid(f"{_describe(node)}: {_first_error(e)}") from e
        node["data"] = data

    by_id = {n["id"]: n for n in nodes}
    edges: dict[tuple[str, str], dict] = {}
    for e in graph.edges:
        src, dst = by_id.get(e.source), by_id.get(e.target)
        handle = e.sourceHandle or "next"
        if not src or not dst or dst["type"] == "start" or handle not in handles(src):
            continue
        # One connection per output; the later one wins.
        edges[(e.source, handle)] = {"id": e.id, "source": e.source, "sourceHandle": handle, "target": e.target}

    cleaned = {"nodes": nodes, "edges": list(edges.values())}
    if strict and not next_target(cleaned, start_node(cleaned)["id"], "next"):
        raise FlowInvalid("Connect the Trigger to the first step")
    return cleaned


def new_graph() -> dict:
    return {"nodes": [{"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "data": {}}], "edges": []}
