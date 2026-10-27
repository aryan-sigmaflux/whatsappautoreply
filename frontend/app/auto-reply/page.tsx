'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FlaskConical, Pencil, Plus, Search, Trash2, Zap } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import AppShell, { useWorkspaces } from '@/components/AppShell';
import NoWorkspace from '@/components/NoWorkspace';
import ResponsePreview from '@/components/ResponsePreview';
import TryMessageModal from '@/components/TryMessageModal';
import { Button, ErrorText, Input, Modal, Select, Spinner, Toggle } from '@/components/ui';
import { endpoints, formatDate, MATCH_LABEL, RESPONSE_LABEL, type Trigger, type Workspace } from '@/lib/api';

type Filter = 'all' | 'equals' | 'contains' | 'any' | 'active' | 'inactive';

function Condition({ t }: { t: Trigger }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-slate-500">If message</span>
      <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100">
        {MATCH_LABEL[t.match_type]}
      </span>
      {t.keywords.map((k, i) => (
        <span key={i} className="font-medium text-slate-900">
          {k}
          {i < t.keywords.length - 1 && <span className="text-slate-400">,</span>}
        </span>
      ))}
      {t.source && (
        <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 ring-1 ring-amber-100">
          from {t.source}
        </span>
      )}
    </div>
  );
}

function TriggerList({ ws }: { ws: Workspace }) {
  const qc = useQueryClient();
  const key = ['triggers', ws.id];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => endpoints.triggers(ws.id) });
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<Trigger | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [trying, setTrying] = useState(false);

  const triggers = useMemo(() => data ?? [], [data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return triggers.filter((t) => {
      if (filter === 'active' && !t.is_active) return false;
      if (filter === 'inactive' && t.is_active) return false;
      if ((filter === 'equals' || filter === 'contains' || filter === 'any') && t.match_type !== filter) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || t.keywords.some((k) => k.toLowerCase().includes(q));
    });
  }, [triggers, filter, search]);

  const toggle = useMutation({
    mutationFn: (t: Trigger) => endpoints.setTriggerStatus(ws.id, t.id, !t.is_active),
    onSuccess: (updated) =>
      qc.setQueryData<Trigger[]>(key, (old) => old?.map((t) => (t.id === updated.id ? updated : t))),
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) =>
      ids.length === 1 ? endpoints.deleteTrigger(ws.id, ids[0]!) : endpoints.bulkDeleteTriggers(ws.id, ids),
    onSuccess: (_, ids) => {
      qc.setQueryData<Trigger[]>(key, (old) => old?.filter((t) => !ids.includes(t.id)));
      setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
      setDeleting(null);
    },
  });

  const allSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Auto Reply</h1>
          <p className="mt-2 text-sm text-slate-600">
            Total: <span className="font-semibold text-slate-900">{triggers.length}</span> auto replies
          </p>
          <p className="mt-1 max-w-xl text-sm text-muted">
            When more than one trigger matches, an exact match (Equals) wins over Contains, and Contains wins over Any
            message.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setTrying(true)}>
            <FlaskConical className="size-4" /> Try a message
          </Button>
          <Link href="/auto-reply/new">
            <Button>
              <Plus className="size-4" /> Create Keyword Trigger
            </Button>
          </Link>
        </div>
      </div>

      {!ws.is_active && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Auto replies are paused for {ws.name}. Turn them on in{' '}
          <Link href="/setup" className="font-medium underline">
            Setup
          </Link>
          .
        </p>
      )}
      {!ws.has_api_key && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          No GetGabs API key for {ws.name}, so replies can&apos;t be sent.{' '}
          <Link href="/setup" className="font-medium underline">
            Add it in Setup
          </Link>
          .
        </p>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="sm:w-44">
          <option value="all">All</option>
          <option value="equals">Equals</option>
          <option value="contains">Contains</option>
          <option value="any">Any message</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keywords..."
            className="pl-9"
          />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-slate-100 px-4 py-2 text-sm">
          <span>{selected.size} selected</span>
          <Button variant="danger" className="py-1.5" onClick={() => setDeleting([...selected])}>
            <Trash2 className="size-4" /> Delete selected
          </Button>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorText error={error} />
      ) : triggers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white px-6 py-16 text-center">
          <Zap className="mx-auto size-8 text-slate-400" />
          <p className="mt-3 font-medium text-slate-800">No keyword triggers yet</p>
          <p className="mt-1 text-sm text-muted">Create one to start replying automatically.</p>
          <Link href="/auto-reply/new">
            <Button className="mt-5">
              <Plus className="size-4" /> Create Keyword Trigger
            </Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b border-line bg-slate-50/60 text-sm text-slate-600">
              <tr>
                <th className="w-12 px-4 py-3.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-slate-800"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(visible.map((t) => t.id)))
                    }
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-3.5 font-medium">Condition</th>
                <th className="px-3 py-3.5 font-medium">Flow Name</th>
                <th className="px-3 py-3.5 font-medium">Type</th>
                <th className="px-3 py-3.5 font-medium">Created</th>
                <th className="px-3 py-3.5 font-medium">Last Updated</th>
                <th className="px-3 py-3.5 font-medium">Status</th>
                <th className="px-4 py-3.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-slate-800"
                      checked={selected.has(t.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        })
                      }
                      aria-label={`Select ${t.name}`}
                    />
                  </td>
                  <td className="max-w-xs px-3 py-3">
                    <Condition t={t} />
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-800">{t.name}</td>
                  <td className="px-3 py-3">
                    <span className="inline-block min-w-24 rounded-full bg-indigo-50 px-3 py-1 text-center text-xs font-medium text-indigo-700 ring-1 ring-indigo-100">
                      {RESPONSE_LABEL[t.response_type]}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <p className="text-slate-700">{formatDate(t.created_at)}</p>
                    {t.created_by && <p className="text-xs text-muted">by {t.created_by.name}</p>}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    <p className="text-slate-700">{formatDate(t.updated_at)}</p>
                    {t.updated_by && <p className="text-xs text-muted">by {t.updated_by.name}</p>}
                  </td>
                  <td className="px-3 py-3">
                    <Toggle
                      checked={t.is_active}
                      onChange={() => toggle.mutate(t)}
                      disabled={toggle.isPending && toggle.variables?.id === t.id}
                      label={`${t.name} active`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setViewing(t)}
                        className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
                        title="View"
                      >
                        <Eye className="size-4" />
                      </button>
                      <Link
                        href={`/auto-reply/${t.id}`}
                        className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
                        title="Edit"
                      >
                        <Pencil className="size-4" />
                      </Link>
                      <button
                        onClick={() => setDeleting([t.id])}
                        className="rounded-md p-2 text-red-500 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">
                    No triggers match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {toggle.error && (
        <div className="mt-3">
          <ErrorText error={toggle.error} />
        </div>
      )}

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.name ?? ''}
        subtitle={viewing ? `${RESPONSE_LABEL[viewing.response_type]} reply` : undefined}
        icon={<Eye className="size-4" />}
        footer={
          viewing && (
            <Link href={`/auto-reply/${viewing.id}`}>
              <Button>
                <Pencil className="size-4" /> Edit
              </Button>
            </Link>
          )
        }
      >
        {viewing && (
          <div className="space-y-4">
            <Condition t={viewing} />
            <ResponsePreview type={viewing.response_type} response={viewing.response} />
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} triggers?` : 'Delete this trigger?'}
        subtitle="Customers will stop getting these replies. This can't be undone."
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

      <TryMessageModal open={trying} onClose={() => setTrying(false)} workspaceId={ws.id} />
    </div>
  );
}

function AutoReplyPage() {
  const { current, isLoading, error } = useWorkspaces();
  if (isLoading) return <Spinner />;
  if (error) return <div className="p-8"><ErrorText error={error} /></div>;
  if (!current) return <NoWorkspace />;
  return <TriggerList key={current.id} ws={current} />;
}

export default function Page() {
  return (
    <AppShell>
      <AutoReplyPage />
    </AppShell>
  );
}
