'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Copy, ScrollText, Search } from 'lucide-react';
import { Fragment, useState } from 'react';
import { endpoints, formatDateTime, timeAgo, type LogStatus, type WebhookLog, type Workspace } from '@/lib/api';
import { Button, ErrorText, Input, Select, Spinner } from './ui';

const POLL_MS = 5_000;
const PAGE = 100;

const STATUS: Record<LogStatus, { label: string; className: string }> = {
  received: { label: 'Received', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  duplicate: { label: 'Duplicate', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  outbound: { label: 'Outbound', className: 'bg-sky-50 text-sky-700 ring-sky-100' },
  paused: { label: 'Paused', className: 'bg-amber-50 text-amber-800 ring-amber-100' },
  unreadable: { label: 'Unreadable', className: 'bg-red-50 text-red-700 ring-red-100' },
};

function resultTone(log: WebhookLog) {
  const r = log.result ?? '';
  if (r.startsWith('Replied')) return 'text-emerald-700';
  if (r.startsWith('Sending failed') || r.startsWith('Error') || r.startsWith('Not replied')) return 'text-red-600';
  return 'text-slate-500';
}

function Row({ log, open, onToggle }: { log: WebhookLog; open: boolean; onToggle: () => void }) {
  const status = STATUS[log.status] ?? STATUS.received;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Fragment>
      <tr onClick={onToggle} className={`cursor-pointer align-top ${open ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
        <td className="py-3 pr-2 pl-4">
          <Chevron className="mt-0.5 size-4 text-slate-400" />
        </td>
        <td className="px-3 py-3 whitespace-nowrap">
          <p className="text-sm text-slate-800" title={formatDateTime(log.created_at)}>
            {new Date(log.created_at).toLocaleTimeString('en-GB')}
          </p>
          <p className="text-xs text-slate-400">{timeAgo(log.created_at)}</p>
        </td>
        <td className="px-3 py-3">
          <p className="max-w-44 truncate text-sm font-medium text-slate-900">{log.name || '—'}</p>
          <p className="text-xs text-muted">{log.contact ? `+${log.contact}` : 'no number'}</p>
        </td>
        <td className="px-3 py-3">
          <p className="max-w-md text-sm break-words whitespace-pre-wrap text-slate-800">
            {log.message_type && (
              <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                {log.message_type}
              </span>
            )}
            {log.text || <span className="text-slate-400">(no text)</span>}
          </p>
        </td>
        <td className="px-3 py-3">
          <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ${status.className}`}>{status.label}</span>
        </td>
        <td className="py-3 pr-4 pl-3">
          <p className={`max-w-sm text-sm ${resultTone(log)}`}>
            {log.result ?? <span className="text-slate-400">Handling…</span>}
          </p>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td />
          <td colSpan={5} className="pr-4 pb-4">
            <div className="relative">
              <button
                onClick={() => navigator.clipboard?.writeText(JSON.stringify(log.payload, null, 2))}
                className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs text-slate-600 ring-1 ring-line hover:bg-slate-100"
              >
                <Copy className="size-3.5" /> Copy
              </button>
              <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
                {JSON.stringify(log.payload, null, 2)}
              </pre>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function LogView({ ws }: { ws: Workspace }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | LogStatus>('');
  const [openId, setOpenId] = useState<number | null>(null);
  const q = search.trim();

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['logs', ws.id, q, status],
    queryFn: ({ pageParam }) => endpoints.logs(ws.id, { q, status, before: pageParam, limit: PAGE }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
    refetchInterval: POLL_MS,
    placeholderData: (previous) => previous,
  });
  const logs = data?.pages.flat() ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Logs</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Everything GetGabs sends to this account&apos;s webhook URL, newest first, including retries and messages
          we ignore. Click a row to see the raw payload. Kept for 30 days.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Last message received:{' '}
          <span className="font-medium text-slate-900">
            {ws.last_webhook_at ? `${timeAgo(ws.last_webhook_at)} (${formatDateTime(ws.last_webhook_at)})` : 'never'}
          </span>
        </p>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Select value={status} onChange={(e) => setStatus(e.target.value as '' | LogStatus)} className="sm:w-44">
          <option value="">All</option>
          {(Object.keys(STATUS) as LogStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </Select>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, number or message..."
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorText error={error} />
      ) : !logs.length ? (
        <div className="rounded-xl border border-line bg-white px-6 py-16 text-center">
          <ScrollText className="mx-auto size-8 text-slate-400" />
          <p className="mt-3 font-medium text-slate-800">{q || status ? 'No logs match' : 'Nothing received yet'}</p>
          {!q && !status && (
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              If customers are messaging this number, check that the webhook URL from Setup is pasted into this GetGabs
              account. Every request to it shows up here.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-left">
              <thead className="border-b border-line bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="w-8 py-2.5 pl-4" />
                  <th className="px-3 py-2.5">Time</th>
                  <th className="px-3 py-2.5">Contact</th>
                  <th className="px-3 py-2.5">Message</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="py-2.5 pr-4 pl-3">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {logs.map((log) => (
                  <Row
                    key={log.id}
                    log={log}
                    open={openId === log.id}
                    onToggle={() => setOpenId((id) => (id === log.id ? null : log.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {hasNextPage && (
            <div className="mt-4 text-center">
              <Button variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
                Load older
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
