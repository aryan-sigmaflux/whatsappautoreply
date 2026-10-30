'use client';

import '@xyflow/react/dist/style.css';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react';
import { ArrowLeft, Lightbulb, List, MessageCircleQuestion, Play, Reply, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  endpoints,
  type Flow,
  type FlowGraph,
  type FlowNodeData,
  type FlowNodeType,
  type FlowStatus,
  type SendType,
} from '@/lib/api';
import { defaults, newId } from '../ResponseForm';
import { Button } from '../ui';
import NodeEditor from './NodeEditor';
import { BuilderContext, edgeTypes, nodeHandles, nodeTypes, SEND_LABEL, type BuilderNode } from './nodes';
import TestPanel from './TestPanel';

// ── Palette ─────────────────────────────────────────

type PaletteItem = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  type: FlowNodeType;
  data: () => FlowNodeData;
};

const send = (t: SendType): PaletteItem => ({
  key: t,
  label: SEND_LABEL[t].label,
  icon: SEND_LABEL[t].icon,
  tint: 'bg-sky-50 text-sky-600',
  type: 'send',
  data: () => ({ response_type: t, response: defaults()[t] }),
});

const PALETTE: { group: string; items: PaletteItem[] }[] = [
  { group: 'Send', items: [send('text'), send('file'), send('cta_url'), send('location')] },
  {
    group: 'Wait for a reply',
    items: [
      {
        key: 'buttons',
        label: 'Quick Reply',
        icon: Reply,
        tint: 'bg-violet-50 text-violet-600',
        type: 'buttons',
        data: () => ({ response: defaults().quick_reply }),
      },
      {
        key: 'list',
        label: 'Interactive List',
        icon: List,
        tint: 'bg-indigo-50 text-indigo-600',
        type: 'list',
        data: () => ({ response: defaults().list }),
      },
      {
        key: 'question',
        label: 'Question',
        icon: MessageCircleQuestion,
        tint: 'bg-amber-50 text-amber-600',
        type: 'question',
        data: () => ({ body: '', cases: [{ id: newId('case'), match_type: 'equals', keywords: [] }] }),
      },
    ],
  },
];
const PALETTE_BY_KEY = Object.fromEntries(PALETTE.flatMap((g) => g.items).map((i) => [i.key, i]));
const DRAG_TYPE = 'application/x-flow-step';

// ── Graph conversion ────────────────────────────────

function toBuilderNodes(graph: FlowGraph): BuilderNode[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: n.data ?? {},
    deletable: n.type !== 'start',
  }));
}

function toBuilderEdges(graph: FlowGraph): Edge[] {
  return graph.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? 'next', type: 'deletable' }));
}

function toGraph(nodes: BuilderNode[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as FlowNodeType,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: n.data,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? 'next' })),
  };
}

// ── Builder ─────────────────────────────────────────

function Builder({ workspaceId, flow }: { workspaceId: string; flow: Flow }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { screenToFlowPosition, deleteElements, fitView } = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);

  // Frame the whole flow once every step has been measured.
  const measured = useNodesInitialized();
  const framed = useRef(false);
  useEffect(() => {
    if (!measured || framed.current) return;
    framed.current = true;
    fitView({ padding: 0.15, maxZoom: 1 });
  }, [measured, fitView]);

  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(toBuilderNodes(flow.graph));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toBuilderEdges(flow.graph));
  const [name, setName] = useState(flow.name);
  const [description, setDescription] = useState(flow.description ?? '');
  const [status, setStatus] = useState<FlowStatus>(flow.status);
  const [triggers, setTriggers] = useState(flow.triggers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'edit' | 'test' | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const snapshot = (n: BuilderNode[], e: Edge[], nm: string, d: string, s: FlowStatus) =>
    JSON.stringify({ g: toGraph(n, e), nm: nm.trim(), d: d.trim(), s });
  const [saved, setSaved] = useState(() =>
    snapshot(toBuilderNodes(flow.graph), toBuilderEdges(flow.graph), flow.name, flow.description ?? '', flow.status),
  );
  const dirty = snapshot(nodes, edges, name, description, status) !== saved;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () =>
      endpoints.saveFlow(workspaceId, flow.id, {
        name: name.trim() || flow.name,
        description: description.trim() || null,
        status,
        graph: toGraph(nodes, edges),
      }),
    onSuccess: (f) => {
      // The server drops dangling connections and normalises steps; show exactly what it stored.
      const n = toBuilderNodes(f.graph).map((node) => ({ ...node, selected: node.id === selectedId }));
      const e = toBuilderEdges(f.graph);
      setNodes(n);
      setEdges(e);
      setName(f.name);
      setTriggers(f.triggers);
      setSaved(snapshot(n, e, f.name, f.description ?? '', f.status));
      qc.invalidateQueries({ queryKey: ['flows', workspaceId] });
    },
  });

  const getGraph = useCallback(() => toGraph(nodes, edges), [nodes, edges]);

  const addStep = useCallback(
    (key: string, position?: { x: number; y: number }) => {
      const item = PALETTE_BY_KEY[key];
      if (!item) return;
      let pos = position;
      if (!pos) {
        const r = canvas.current!.getBoundingClientRect();
        pos = screenToFlowPosition({ x: r.left + r.width / 2 - 144, y: r.top + r.height / 3 });
      }
      const id = newId('step');
      setNodes((ns) => [
        ...ns.map((n) => ({ ...n, selected: false })),
        { id, type: item.type, position: pos, data: item.data(), selected: true },
      ]);
      setSelectedId(id);
      setPanel('edit');
    },
    [screenToFlowPosition, setNodes],
  );

  const updateData = useCallback(
    (id: string, data: FlowNodeData) => {
      let type: FlowNodeType | undefined;
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== id) return n;
          type = n.type;
          return { ...n, data };
        }),
      );
      // Removing a button or row removes its connection too.
      const valid = new Set(nodeHandles(type ?? nodes.find((n) => n.id === id)?.type, data));
      setEdges((es) => es.filter((e) => e.source !== id || valid.has(e.sourceHandle ?? 'next')));
    },
    [nodes, setEdges, setNodes],
  );

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((es) =>
        addEdge(
          { ...c, id: newId('edge'), type: 'deletable' },
          // One connection per output: a new one replaces the old.
          es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? 'next') === (c.sourceHandle ?? 'next'))),
        ),
      ),
    [setEdges],
  );

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const context = useMemo(() => ({ triggers, activeNodeId }), [triggers, activeNodeId]);

  const leave = () => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    router.push('/flows');
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-2.5">
        <button onClick={leave} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Back to flows">
          <ArrowLeft className="size-5" />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-56 rounded-md px-2 py-1 font-semibold text-slate-900 outline-none hover:bg-slate-50 focus:bg-slate-50"
          aria-label="Flow name"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          className="hidden min-w-0 flex-1 border-l border-line px-3 py-1 text-sm text-slate-600 outline-none md:block"
        />
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-line p-0.5 text-sm">
            {(['active', 'draft'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-md px-3 py-1 font-medium ${
                  status === s ? (s === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700') : 'text-slate-500'
                }`}
              >
                {s === 'active' ? 'Active' : 'Draft'}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setPanel(panel === 'test' ? null : 'test');
              setActiveNodeId(null);
            }}
            className={panel === 'test' ? 'border-sky-300 bg-sky-50 text-sky-700' : ''}
          >
            <Play className="size-4" /> Test
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty && !save.isError}>
            <Save className="size-4" /> {dirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </header>
      {save.error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{(save.error as Error).message}</div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-white p-4 md:block">
          <p className="text-xs font-semibold tracking-wide text-slate-900 uppercase">Components</p>
          <p className="text-xs text-muted">Drag onto the canvas, or click to add</p>
          <div className="mt-3 flex gap-2 rounded-xl bg-indigo-50 p-3 text-xs text-indigo-800">
            <Lightbulb className="size-4 shrink-0" />
            <span>Connect steps by dragging from a dot on one step to the top of another.</span>
          </div>
          {PALETTE.map((g) => (
            <div key={g.group} className="mt-5">
              <p className="mb-2 text-xs font-medium tracking-wide text-slate-400 uppercase">{g.group}</p>
              <div className="grid grid-cols-2 gap-2">
                {g.items.map((item) => (
                  <button
                    key={item.key}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, item.key);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => addStep(item.key)}
                    className="flex cursor-grab flex-col items-center gap-1.5 rounded-xl border border-line px-2 py-3 text-center text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 active:cursor-grabbing"
                  >
                    <span className={`flex size-8 items-center justify-center rounded-lg ${item.tint}`}>
                      <item.icon className="size-4" />
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* Canvas */}
        <div
          ref={canvas}
          className="relative min-w-0 flex-1"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(e) => {
            const key = e.dataTransfer.getData(DRAG_TYPE);
            if (!key) return;
            e.preventDefault();
            const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            addStep(key, { x: p.x - 144, y: p.y - 20 });
          }}
        >
          <BuilderContext.Provider value={context}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => {
                setSelectedId(n.id);
                setPanel('edit');
              }}
              onPaneClick={() => {
                setSelectedId(null);
                if (panel === 'edit') setPanel(null);
              }}
              onNodesDelete={(deleted) => {
                if (deleted.some((n) => n.id === selectedId)) {
                  setSelectedId(null);
                  setPanel((p) => (p === 'edit' ? null : p));
                }
              }}
              deleteKeyCode={['Backspace', 'Delete']}
              defaultEdgeOptions={{ type: 'deletable' }}
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap pannable zoomable position="bottom-right" className="!rounded-xl !border !border-line" />
            </ReactFlow>
          </BuilderContext.Provider>
          {nodes.length === 1 && (
            <p className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm text-slate-500 shadow-sm ring-1 ring-line">
              Add a step from the left, then connect the Trigger to it
            </p>
          )}
        </div>

        {/* Side panel */}
        {panel && (
          <aside className="w-full max-w-[420px] shrink-0 border-l border-line bg-white max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20">
            {panel === 'edit' && selected ? (
              <NodeEditor
                key={selected.id}
                workspaceId={workspaceId}
                node={selected}
                onChange={(data) => updateData(selected.id, data)}
                onDelete={() => {
                  deleteElements({ nodes: [{ id: selected.id }] });
                  setSelectedId(null);
                  setPanel(null);
                }}
                onClose={() => setPanel(null)}
              />
            ) : panel === 'test' ? (
              <TestPanel
                workspaceId={workspaceId}
                flowId={flow.id}
                getGraph={getGraph}
                onWaitingChange={setActiveNodeId}
                onClose={() => setPanel(null)}
              />
            ) : null}
          </aside>
        )}
      </div>
    </div>
  );
}

export default function FlowBuilder({ workspaceId, flow }: { workspaceId: string; flow: Flow }) {
  return (
    <ReactFlowProvider>
      <Builder workspaceId={workspaceId} flow={flow} />
    </ReactFlowProvider>
  );
}
