'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, Image as ImageIcon, List, MapPin, Music, Reply, Video, Workflow } from 'lucide-react';
import Link from 'next/link';
import type {
  AnyResponse,
  CtaUrlResponse,
  FileResponse,
  FlowRefResponse,
  Header,
  ListResponse,
  LocationResponse,
  QuickReplyResponse,
  ResponseType,
  TextResponse,
} from '@/lib/api';
import { endpoints } from '@/lib/api';
import { useWorkspaces } from './AppShell';

const SAMPLE_NAME = 'Rahul';

function fill(text?: string) {
  return (text ?? '').replaceAll('{{name}}', SAMPLE_NAME);
}

function Media({ kind, url, filename }: { kind: string; url?: string; filename?: string }) {
  if (kind === 'image' && url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="mb-1 max-h-48 w-full rounded-md object-cover" />;
  }
  if (kind === 'video' && url) {
    return <video src={url} className="mb-1 max-h-48 w-full rounded-md bg-black" controls />;
  }
  const Icon = kind === 'audio' ? Music : kind === 'video' ? Video : kind === 'image' ? ImageIcon : FileText;
  return (
    <div className="mb-1 flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2.5 text-xs text-slate-600">
      <Icon className="size-5 shrink-0 text-slate-500" />
      <span className="truncate">{filename || (url ? url.split('/').pop() : `No ${kind} selected`)}</span>
    </div>
  );
}

function HeaderView({ header }: { header?: Header }) {
  if (!header || header.type === 'none') return null;
  if (header.type === 'text') return <p className="mb-1 font-semibold">{fill(header.text)}</p>;
  return <Media kind={header.type} url={header.url} filename={header.filename} />;
}

function Bubble({ children, buttons }: { children: React.ReactNode; buttons?: React.ReactNode }) {
  return (
    <div className="max-w-[280px] text-[13px] leading-snug text-slate-800">
      <div className="rounded-lg rounded-tl-none bg-wa-bubble px-2.5 py-2 shadow-sm">
        {children}
        <p className="mt-0.5 text-right text-[10px] text-slate-400">12:00</p>
      </div>
      {buttons && <div className="mt-0.5 space-y-0.5">{buttons}</div>}
    </div>
  );
}

function ActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 rounded-lg bg-wa-bubble py-2 text-[13px] font-medium text-sky-600 shadow-sm">
      {icon}
      {label || '—'}
    </div>
  );
}

function Body({ text, footer }: { text?: string; footer?: string }) {
  return (
    <>
      <p className="whitespace-pre-wrap break-words">{fill(text) || <span className="text-slate-400">Message body</span>}</p>
      {footer && <p className="mt-1 text-xs text-slate-500">{fill(footer)}</p>}
    </>
  );
}

function FlowCard({ flowId }: { flowId: string }) {
  const ws = useWorkspaces().current?.id;
  const { data } = useQuery({ queryKey: ['flows', ws], queryFn: () => endpoints.flows(ws!), enabled: !!ws && !!flowId });
  const flow = data?.find((f) => f.id === flowId);
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white px-3 py-3 shadow-sm">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <Workflow className="size-4" />
      </span>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="text-slate-500">Starts flow</p>
        <p className="truncate font-medium text-slate-900">{flow?.name ?? (flowId ? 'Flow' : 'No flow selected')}</p>
        {flow?.status === 'draft' && <p className="text-xs text-amber-700">Draft, won&apos;t run yet</p>}
      </div>
      {flowId && (
        <Link href={`/flows/${flowId}`} className="text-xs font-medium text-sky-600 hover:underline">
          Open
        </Link>
      )}
    </div>
  );
}

/** One message as WhatsApp would show it, without the chat background. */
export function MessageBubble({ type, response }: { type: ResponseType; response: AnyResponse }) {
  return render(type, response);
}

function render(type: ResponseType, response: AnyResponse) {
  switch (type) {
    case 'text': {
      const r = response as TextResponse;
      return (
        <Bubble>
          <Body text={r.body} />
        </Bubble>
      );
    }
    case 'file': {
      const r = response as FileResponse;
      return (
        <Bubble>
          <Media kind={r.media_type} url={r.url} filename={r.filename} />
          {r.caption && <p className="whitespace-pre-wrap">{fill(r.caption)}</p>}
        </Bubble>
      );
    }
    case 'quick_reply': {
      const r = response as QuickReplyResponse;
      return (
        <Bubble
          buttons={(r.buttons ?? []).map((b, i) => (
            <ActionButton key={i} icon={<Reply className="size-3.5" />} label={b.title} />
          ))}
        >
          <HeaderView header={r.header} />
          <Body text={r.body} footer={r.footer} />
        </Bubble>
      );
    }
    case 'cta_url': {
      const r = response as CtaUrlResponse;
      return (
        <Bubble buttons={<ActionButton icon={<ExternalLink className="size-3.5" />} label={r.display_text} />}>
          <HeaderView header={r.header} />
          <Body text={r.body} footer={r.footer} />
        </Bubble>
      );
    }
    case 'list': {
      const r = response as ListResponse;
      return (
        <Bubble buttons={<ActionButton icon={<List className="size-3.5" />} label={r.button_text} />}>
          {r.header_text && <p className="mb-1 font-semibold">{fill(r.header_text)}</p>}
          <Body text={r.body} footer={r.footer} />
        </Bubble>
      );
    }
    case 'flow':
      return <FlowCard flowId={(response as FlowRefResponse).flow_id} />;
    case 'location': {
      const r = response as LocationResponse;
      const has = r.latitude !== '' && r.longitude !== '' && r.latitude != null && r.longitude != null;
      return (
        <Bubble>
          <div className="mb-1 flex h-24 items-center justify-center rounded-md bg-emerald-50">
            <MapPin className="size-7 text-red-500" />
          </div>
          <p className="font-medium">{r.name || 'Location'}</p>
          {r.address && <p className="text-xs text-slate-500">{r.address}</p>}
          {has && (
            <p className="text-xs text-slate-400">
              {r.latitude}, {r.longitude}
            </p>
          )}
        </Bubble>
      );
    }
  }
}

export default function ResponsePreview({ type, response }: { type: ResponseType; response: AnyResponse }) {
  return (
    <div className="rounded-xl bg-wa-bg p-4">
      <p className="mb-2 text-center text-[11px] text-slate-500">Preview · {'{{name}}'} shown as “{SAMPLE_NAME}”</p>
      {render(type, response)}
    </div>
  );
}
