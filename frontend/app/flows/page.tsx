'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Copy, Pencil, Plus, Search, Sparkles, Trash2, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import AppShell, { useWorkspaces } from '@/components/AppShell';
import NoWorkspace from '@/components/NoWorkspace';
import { Button, ErrorText, Field, Input, Modal, Select, Spinner, Textarea } from '@/components/ui';
import { endpoints, timeAgo, type FlowSummary, type Workspace } from '@/lib/api';

type Filter = 'all' | 'active' | 'draft';

function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50/60">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className="flex size-9 items-center justify-center rounded-full bg-white text-indigo-600 ring-1 ring-indigo-100">
          <Sparkles className="size-4" />
        </span>
        <div className="flex-1">
          <p className="font-medium text-indigo-900">How flows work</p>
          <p className="text-sm text-indigo-700">Click to see the 3-step setup guide</p>
        </div>
        <ChevronDown className={`size-5 text-indigo-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol className="grid gap-4 border-t border-indigo-200 px-5 py-4 text-sm text-slate-700 md:grid-cols-3">
          <li>
            <p className="font-medium text-slate-900">1. Build the flow</p>
            Drag steps onto the canvas and connect them. Quick Reply, List and Question steps wait for the customer, and
            each option gets its own path.
          </li>
          <li>
            <p className="font-medium text-slate-900">2. Set it Active and save</p>
            Drafts never run. Use <span className="font-medium">Test</span> in the builder to walk through it first.
          </li>
          <li>
            <p className="font-medium text-slate-900">3. Start it from a keyword</p>
            In Auto Reply, create a keyword trigger and pick <span className="font-medium">Flow</span> as the response.
          </li>
        </ol>
      )}
    </div>
  );
}

function NewFlowModal({ ws, open, onClose }: { ws: Workspace; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => endpoints.createFlow(ws.id, { name, description }),
    onSuccess: (f) => router.push(`/flows/${f.id}`),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New flow"
      subtitle="You'll build the steps on the next screen."
      icon={<Workflow className="size-4" />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Field label="Name" required>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Blue sparrow project" />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </Field>
        <ErrorText error={create.error} />
      </form>
    </Modal>
  );
}

function FlowList({ ws }: { ws: Workspace }) {
  const qc = useQueryClient();
  const router = useRouter();
  const key = ['flows', ws.id];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => endpoints.flows(ws.id) });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FlowSummary | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter(
      (f) =>
        (filter === 'all' || f.status === filter) &&
        (!q ||
          f.name.toLowerCase().includes(q) ||
          f.triggers.some((t) => t.keywords.some((k) => k.toLowerCase().includes(q)))),
    );
  }, [data, search, filter]);

  const duplicate = useMutation({
    mutationFn: (f: FlowSummary) => endpoints.duplicateFlow(ws.id, f.id),
    onSuccess: (f) => {
      qc.invalidateQueries({ queryKey: key });
      router.push(`/flows/${f.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (f: FlowSummary) => endpoints.deleteFlow(ws.id, f.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setDeleting(null);
    },
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Flow Builder</h1>
          <p className="mt-1 text-sm text-muted">Build multi-step conversations that branch on what the customer replies.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New Flow
        </Button>
      </div>

      <HowItWorks />

      <div className="rounded-2xl border border-line bg-white">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search flows or keywords..." className="pl-9" />
          </div>
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="sm:w-40">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
          </Select>
        </div>

        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4">
            <ErrorText error={error} />
          </div>
        ) : !data?.length ? (
          <div className="px-6 py-16 text-center">
            <Workflow className="mx-auto size-8 text-slate-400" />
            <p className="mt-3 font-medium text-slate-800">No flows yet</p>
            <p className="mt-1 text-sm text-muted">Create one, then start it from a keyword trigger.</p>
            <Button className="mt-5" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New Flow
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead className="border-b border-line bg-slate-50/60 text-sm text-slate-600">
                <tr>
                  <th className="w-12 px-5 py-3.5 font-medium">#</th>
                  <th className="px-3 py-3.5 font-medium">Flow</th>
                  <th className="px-3 py-3.5 font-medium">Status</th>
                  <th className="px-3 py-3.5 font-medium">Started by</th>
                  <th className="px-3 py-3.5 font-medium">Created</th>
                  <th className="px-3 py-3.5 font-medium">Last Modified</th>
                  <th className="px-5 py-3.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((f, i) => (
                  <tr key={f.id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3.5 text-sm text-slate-500">{i + 1}</td>
                    <td className="px-3 py-3.5">
                      <Link href={`/flows/${f.id}`} className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                          <Workflow className="size-4" />
                        </span>
                        <span>
                          <span className="block font-medium text-slate-900">{f.name}</span>
                          <span className="block text-xs text-muted">
                            {f.node_count} step{f.node_count === 1 ? '' : 's'}
                            {f.description ? ` · ${f.description}` : ''}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                          f.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                            : 'bg-slate-100 text-slate-600 ring-slate-200'
                        }`}
                      >
                        {f.status === 'active' ? 'Active' : 'Draft'}
                      </span>
                    </td>
                    <td className="max-w-56 px-3 py-3.5 text-sm">
                      {f.triggers.length ? (
                        <span className="line-clamp-2 text-slate-700">
                          {f.triggers.flatMap((t) => t.keywords).join(', ') || 'Any message'}
                        </span>
                      ) : (
                        <span className="text-muted">No trigger yet</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-sm text-slate-600">{timeAgo(f.created_at)}</td>
                    <td className="px-3 py-3.5 text-sm text-slate-600">{timeAgo(f.updated_at)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => duplicate.mutate(f)}
                          className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
                          title="Duplicate"
                        >
                          <Copy className="size-4" />
                        </button>
                        <Link href={`/flows/${f.id}`} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" title="Edit">
                          <Pencil className="size-4" />
                        </Link>
                        <button onClick={() => setDeleting(f)} className="rounded-md p-2 text-red-500 hover:bg-red-50" title="Delete">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-muted">
                      No flows match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ErrorText error={duplicate.error} />

      <NewFlowModal ws={ws} open={creating} onClose={() => setCreating(false)} />
      <Modal
        open={!!deleting}
        onClose={() => {
          setDeleting(null);
          remove.reset();
        }}
        title={`Delete ${deleting?.name ?? 'flow'}?`}
        subtitle="Customers part-way through it stop getting its messages. This can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              Delete
            </Button>
          </>
        }
      >
        <ErrorText error={remove.error} />
      </Modal>
    </div>
  );
}

function FlowsPage() {
  const { current, isLoading, error } = useWorkspaces();
  if (isLoading) return <Spinner />;
  if (error)
    return (
      <div className="p-8">
        <ErrorText error={error} />
      </div>
    );
  if (!current) return <NoWorkspace />;
  return <FlowList key={current.id} ws={current} />;
}

export default function Page() {
  return (
    <AppShell>
      <FlowsPage />
    </AppShell>
  );
}
