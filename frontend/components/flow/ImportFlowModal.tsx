'use client';

import { useMutation } from '@tanstack/react-query';
import { Download, FileJson, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { endpoints, type FlowGraph, type Workspace } from '@/lib/api';
import { Button, ErrorText, Field, Input, Modal } from '../ui';

/**
 * The file format: { name, description?, graph: { nodes, edges } }, the same shape the
 * builder saves. Steps may leave out "position"; the import then lays the flow out itself.
 * Button, row and case ids only need to be unique within the file (they are replaced on import).
 */
const SAMPLE = {
  name: 'Sample flow',
  description: 'A Quick Reply menu, a message, and a question with keyword answers',
  graph: {
    nodes: [
      { id: 'start', type: 'start', data: {} },
      {
        id: 'welcome',
        type: 'buttons',
        data: {
          response: {
            header: { type: 'text', text: 'Welcome' },
            body: 'Hi {{name}}! What would you like to do?',
            footer: 'Tap a button below',
            buttons: [
              { id: 'pricing', title: 'See pricing' },
              { id: 'visit', title: 'Visit us' },
            ],
          },
        },
      },
      {
        id: 'pricing_msg',
        type: 'send',
        data: { response_type: 'text', response: { body: 'Our plans start at ₹999 a month.' } },
      },
      {
        id: 'city',
        type: 'question',
        data: {
          body: 'Which city are you in?',
          cases: [
            { id: 'mumbai', match_type: 'contains', keywords: ['mumbai', 'bombay'] },
            { id: 'pune', match_type: 'equals', keywords: ['pune'] },
          ],
        },
      },
      {
        id: 'mumbai_msg',
        type: 'send',
        data: { response_type: 'text', response: { body: 'Our Mumbai office is in Andheri East.' } },
      },
      {
        id: 'pune_msg',
        type: 'send',
        data: { response_type: 'text', response: { body: 'Our Pune office is in Baner.' } },
      },
      {
        id: 'other_city_msg',
        type: 'send',
        data: {
          response_type: 'cta_url',
          response: { body: 'Find the office nearest to you on our website.', display_text: 'Open map', url: 'https://example.com/offices' },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', sourceHandle: 'next', target: 'welcome' },
      { id: 'e2', source: 'welcome', sourceHandle: 'pricing', target: 'pricing_msg' },
      { id: 'e3', source: 'welcome', sourceHandle: 'visit', target: 'city' },
      { id: 'e4', source: 'city', sourceHandle: 'mumbai', target: 'mumbai_msg' },
      { id: 'e5', source: 'city', sourceHandle: 'pune', target: 'pune_msg' },
      { id: 'e6', source: 'city', sourceHandle: 'default', target: 'other_city_msg' },
    ],
  },
};

type Parsed = { name: string; description: string | null; graph: FlowGraph };

function parse(text: string, fileName: string): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON.");
  }
  if (!data || typeof data !== 'object') throw new Error('The file should contain a JSON object.');
  const obj = data as Record<string, unknown>;
  // Accept { name, graph: { nodes, edges } } or just { nodes, edges }.
  const graph = (obj.graph && typeof obj.graph === 'object' ? obj.graph : obj) as Partial<FlowGraph>;
  if (!Array.isArray(graph.nodes)) throw new Error('No "nodes" list found. Download the sample to see the format.');
  if (graph.edges !== undefined && !Array.isArray(graph.edges)) throw new Error('"edges" should be a list.');
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : fileName.replace(/\.json$/i, '');
  const description = typeof obj.description === 'string' ? obj.description : null;
  return { name, description, graph: { nodes: graph.nodes, edges: graph.edges ?? [] } };
}

function downloadSample() {
  const blob = new Blob([JSON.stringify(SAMPLE, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sample-flow.json';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportFlowModal({ ws, open, onClose }: { ws: Workspace; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [dragging, setDragging] = useState(false);

  const save = useMutation({
    mutationFn: () => endpoints.importFlow(ws.id, { ...parsed!, name: name.trim() }),
    onSuccess: (f) => router.push(`/flows/${f.id}`),
  });

  const close = () => {
    setFileName('');
    setParsed(null);
    setParseError(null);
    setName('');
    save.reset();
    onClose();
  };

  const read = async (file: File | undefined) => {
    if (!file) return;
    save.reset();
    setFileName(file.name);
    try {
      const p = parse(await file.text(), file.name);
      setParsed(p);
      setName(p.name);
      setParseError(null);
    } catch (e) {
      setParsed(null);
      setParseError((e as Error).message);
    }
  };

  const steps = parsed ? parsed.graph.nodes.filter((n) => n?.type !== 'start').length : 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import flow from JSON"
      subtitle="The flow is created as a Draft so you can check it before setting it Active."
      icon={<FileJson className="size-4" />}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!parsed || !name.trim()}>
            <Upload className="size-4" /> Import
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-slate-50/60 px-4 py-3">
          <div className="text-sm">
            <p className="font-medium text-slate-900">Sample JSON</p>
            <p className="text-muted">Shows the format: steps, their options, and the connections between them.</p>
          </div>
          <Button variant="secondary" onClick={downloadSample} className="shrink-0">
            <Download className="size-4" /> Download sample
          </Button>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-800">Import JSON</p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              read(e.dataTransfer.files[0]);
            }}
            className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
              dragging ? 'border-emerald-400 bg-emerald-50/60' : 'border-line hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Upload className="size-6 text-slate-400" />
            <p className="mt-2 text-sm font-medium text-slate-800">{fileName || 'Choose a .json file'}</p>
            <p className="text-xs text-muted">{fileName ? 'Click to pick a different file' : 'or drop it here'}</p>
          </button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              read(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {parseError && <p className="mt-2 text-sm text-red-600">{parseError}</p>}
        </div>

        {parsed && (
          <>
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {steps} step{steps === 1 ? '' : 's'} and {parsed.graph.edges.length} connection
              {parsed.graph.edges.length === 1 ? '' : 's'} found.
            </p>
            <Field label="Flow name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </>
        )}
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}
