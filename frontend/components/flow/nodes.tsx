'use client';

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  CircleAlert,
  ExternalLink,
  File as FileIcon,
  List,
  MapPin,
  MessageCircleQuestion,
  MessageSquare,
  Reply,
  X,
  Zap,
} from 'lucide-react';
import { createContext, useContext, useEffect } from 'react';
import type {
  CtaUrlResponse,
  FileResponse,
  FlowNodeData,
  FlowNodeType,
  FlowSummary,
  ListResponse,
  LocationResponse,
  QuickReplyResponse,
  SendType,
  TextResponse,
} from '@/lib/api';
import { validateResponse } from '../ResponseForm';

export type BuilderNode = Node<FlowNodeData, FlowNodeType>;

/** Shared with every node: who starts the flow, and which step the Test panel is on. */
export const BuilderContext = createContext<{ triggers: FlowSummary['triggers']; activeNodeId: string | null }>({
  triggers: [],
  activeNodeId: null,
});

// ── Graph helpers (mirror backend app/services/flows.py) ─────────

export function nodeHandles(type: FlowNodeType | undefined, data: FlowNodeData): string[] {
  switch (type) {
    case 'start':
    case 'send':
      return ['next'];
    case 'buttons':
      return [...((data.response as QuickReplyResponse)?.buttons ?? []).map((b) => b.id), 'default'];
    case 'list':
      return [
        ...((data.response as ListResponse)?.sections ?? []).flatMap((s) => s.rows.map((r) => r.id)),
        'default',
      ];
    case 'question':
      return [...(data.cases ?? []).map((c) => c.id), 'default'];
    default:
      return [];
  }
}

/** Why a step isn't ready to go live, or null. */
export function nodeProblem(type: FlowNodeType | undefined, data: FlowNodeData): string | null {
  switch (type) {
    case 'send':
      return data.response_type && data.response ? validateResponse(data.response_type, data.response) : 'Pick a message type.';
    case 'buttons': {
      const r = data.response as QuickReplyResponse;
      const problem = validateResponse('quick_reply', r);
      if (problem) return problem;
      const titles = r.buttons.map((b) => b.title.trim().toLowerCase());
      return new Set(titles).size === titles.length ? null : 'Buttons need different titles.';
    }
    case 'list': {
      const r = data.response as ListResponse;
      const problem = validateResponse('list', r);
      if (problem) return problem;
      const titles = r.sections.flatMap((s) => s.rows.map((row) => row.title.trim().toLowerCase()));
      return new Set(titles).size === titles.length ? null : 'Rows need different titles.';
    }
    case 'question':
      if (!data.body?.trim()) return 'Write the question.';
      if ((data.cases ?? []).some((c) => !c.keywords.length)) return 'Every reply option needs a keyword.';
      return null;
    default:
      return null;
  }
}

export const SEND_LABEL: Record<SendType, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  text: { label: 'Send Message', icon: MessageSquare },
  file: { label: 'Media / File', icon: FileIcon },
  cta_url: { label: 'CTA URL Button', icon: ExternalLink },
  location: { label: 'Location', icon: MapPin },
};

// ── Building blocks ─────────────────────────────────

const handleStyle = { width: 10, height: 10, background: '#334155', border: '2px solid white' };

function Shell({
  id,
  icon: Icon,
  title,
  tint,
  selected,
  problem,
  target = true,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tint: string;
  selected: boolean;
  problem?: string | null;
  target?: boolean;
  children: React.ReactNode;
}) {
  const { activeNodeId } = useContext(BuilderContext);
  const active = activeNodeId === id;
  return (
    <div
      className={`w-72 rounded-xl border bg-white text-left shadow-sm transition-shadow ${
        selected ? 'border-sky-500 ring-2 ring-sky-100' : active ? 'border-emerald-400 ring-4 ring-emerald-100' : 'border-line'
      }`}
    >
      {target && <Handle type="target" position={Position.Top} style={{ ...handleStyle, background: '#fff', border: '2px solid #64748b' }} />}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className={`flex size-6 items-center justify-center rounded-md ${tint}`}>
          <Icon className="size-3.5" />
        </span>
        <span className="flex-1 text-sm font-semibold text-slate-800">{title}</span>
        {problem && (
          <span title={problem} className="text-amber-500">
            <CircleAlert className="size-4" />
          </span>
        )}
      </div>
      <div className="space-y-1.5 p-3">{children}</div>
    </div>
  );
}

function Snippet({ text, placeholder }: { text?: string; placeholder: string }) {
  return text?.trim() ? (
    <p className="line-clamp-3 rounded-md bg-slate-50 px-2.5 py-2 text-xs whitespace-pre-wrap text-slate-700">{text}</p>
  ) : (
    <p className="rounded-md border border-dashed border-line px-2.5 py-2 text-xs text-slate-400">{placeholder}</p>
  );
}

function OptionRow({ id, label, muted }: { id: string; label: string; muted?: boolean }) {
  return (
    <div
      className={`relative rounded-md px-2.5 py-1.5 text-xs font-medium ${
        muted ? 'border border-dashed border-line text-center text-slate-500' : 'bg-slate-100 text-slate-800'
      }`}
    >
      <span className="block truncate pr-2">{label || <span className="text-slate-400">Untitled</span>}</span>
      <Handle type="source" position={Position.Right} id={id} style={{ ...handleStyle, right: -16 }} />
    </div>
  );
}

function NextHandle() {
  return <Handle type="source" position={Position.Bottom} id="next" style={handleStyle} />;
}

/** Re-measure handles when options are added or removed, so edges attach to the right row. */
function useHandleSync(id: string, handles: string[]) {
  const update = useUpdateNodeInternals();
  const key = handles.join('|');
  useEffect(() => {
    update(id);
  }, [id, key, update]);
}

// ── Node types ──────────────────────────────────────

function StartNode({ id, selected }: NodeProps<BuilderNode>) {
  const { triggers } = useContext(BuilderContext);
  const keywords = triggers.flatMap((t) => (t.match_type === 'any' ? ['Any message'] : t.keywords));
  return (
    <Shell id={id} icon={Zap} title="Trigger" tint="bg-emerald-50 text-emerald-600" selected={selected} target={false}>
      <p className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800">Keyword Trigger</p>
      <p className="text-xs text-slate-500">
        {keywords.length ? `Starts on: ${keywords.join(', ')}` : 'Not started by any keyword trigger yet.'}
      </p>
      <NextHandle />
    </Shell>
  );
}

function SendNode({ id, data, selected }: NodeProps<BuilderNode>) {
  const type = data.response_type ?? 'text';
  const { label, icon } = SEND_LABEL[type];
  let summary: string | undefined;
  if (type === 'text') summary = (data.response as TextResponse)?.body;
  if (type === 'file') {
    const r = data.response as FileResponse;
    summary = [r?.url ? `📎 ${r.filename || r.media_type}` : '', r?.caption].filter(Boolean).join('\n');
  }
  if (type === 'cta_url') {
    const r = data.response as CtaUrlResponse;
    summary = [r?.body, r?.display_text ? `🔗 ${r.display_text}` : ''].filter(Boolean).join('\n');
  }
  if (type === 'location') {
    const r = data.response as LocationResponse;
    summary = [r?.name, r?.address].filter(Boolean).join(' · ') || (r && r.latitude !== '' ? `${r.latitude}, ${r.longitude}` : '');
  }
  return (
    <Shell id={id} icon={icon} title={label} tint="bg-sky-50 text-sky-600" selected={selected} problem={nodeProblem('send', data)}>
      <Snippet text={summary} placeholder="Click to write the message" />
      <NextHandle />
    </Shell>
  );
}

function ButtonsNode({ id, data, selected }: NodeProps<BuilderNode>) {
  const r = data.response as QuickReplyResponse;
  useHandleSync(id, nodeHandles('buttons', data));
  return (
    <Shell id={id} icon={Reply} title="Quick Reply" tint="bg-violet-50 text-violet-600" selected={selected} problem={nodeProblem('buttons', data)}>
      <Snippet text={r?.body} placeholder="Click to write the message" />
      {r?.buttons.map((b) => <OptionRow key={b.id} id={b.id} label={b.title} />)}
      <OptionRow id="default" label="No match / default" muted />
    </Shell>
  );
}

function ListNode({ id, data, selected }: NodeProps<BuilderNode>) {
  const r = data.response as ListResponse;
  useHandleSync(id, nodeHandles('list', data));
  return (
    <Shell id={id} icon={List} title="Interactive List" tint="bg-indigo-50 text-indigo-600" selected={selected} problem={nodeProblem('list', data)}>
      <Snippet text={r?.body} placeholder="Click to write the message" />
      {r?.sections.flatMap((s) => s.rows).map((row) => <OptionRow key={row.id} id={row.id} label={row.title} />)}
      <OptionRow id="default" label="No match / default" muted />
    </Shell>
  );
}

function QuestionNode({ id, data, selected }: NodeProps<BuilderNode>) {
  useHandleSync(id, nodeHandles('question', data));
  return (
    <Shell
      id={id}
      icon={MessageCircleQuestion}
      title="Question"
      tint="bg-amber-50 text-amber-600"
      selected={selected}
      problem={nodeProblem('question', data)}
    >
      <Snippet text={data.body} placeholder="Click to write the question" />
      {(data.cases ?? []).map((c) => (
        <OptionRow
          key={c.id}
          id={c.id}
          label={c.keywords.length ? `${c.match_type === 'contains' ? 'Contains' : 'Is'}: ${c.keywords.join(', ')}` : ''}
        />
      ))}
      <OptionRow id="default" label="Anything else / default" muted />
    </Shell>
  );
}

export const nodeTypes = {
  start: StartNode,
  send: SendNode,
  buttons: ButtonsNode,
  list: ListNode,
  question: QuestionNode,
};

// ── Edge with a delete button ───────────────────────

function DeletableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style }: EdgeProps<Edge>) {
  const { setEdges } = useReactFlow();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ ...style, stroke: selected ? '#0ea5e9' : '#94a3b8', strokeWidth: selected ? 2 : 1.5, strokeDasharray: '6 4' }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            onClick={() => setEdges((es) => es.filter((e) => e.id !== id))}
            className="nodrag nopan absolute flex size-6 items-center justify-center rounded-full border border-line bg-white text-slate-500 shadow hover:text-red-600"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
            title="Remove connection"
          >
            <X className="size-3.5" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { deletable: DeletableEdge };
