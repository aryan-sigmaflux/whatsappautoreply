'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ExternalLink,
  File as FileIcon,
  Info,
  List,
  MapPin,
  Reply,
  Trash2,
  Type,
  Workflow,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';
import {
  endpoints,
  type AnyResponse,
  type CtaUrlResponse,
  type FileResponse,
  type FlowRefResponse,
  type Header,
  type ListResponse,
  type LocationResponse,
  type MediaType,
  type QuickReplyResponse,
  type ResponseType,
  type TextResponse,
} from '@/lib/api';
import MediaPicker from './MediaPicker';
import { Button, Field, Input, Select, Textarea } from './ui';

export const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export type Responses = {
  text: TextResponse;
  file: FileResponse;
  quick_reply: QuickReplyResponse;
  cta_url: CtaUrlResponse;
  list: ListResponse;
  location: LocationResponse;
  flow: FlowRefResponse;
};

export const defaults = (): Responses => ({
  text: { body: '' },
  file: { media_type: 'image', url: '', filename: '', caption: '' },
  quick_reply: { header: { type: 'none' }, body: '', footer: '', buttons: [{ id: newId('btn'), title: '' }] },
  cta_url: { header: { type: 'none' }, body: '', footer: '', display_text: '', url: '' },
  list: {
    header_text: '',
    body: '',
    footer: '',
    button_text: '',
    sections: [{ title: '', rows: [{ id: newId('row'), title: '', description: '' }] }],
  },
  location: { latitude: '', longitude: '', name: '', address: '' },
  flow: { flow_id: '' },
});

export const RESPONSE_TYPES: { type: ResponseType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'file', label: 'File', icon: FileIcon },
  { type: 'quick_reply', label: 'Quick Reply', icon: Reply },
  { type: 'cta_url', label: 'CTA URL', icon: ExternalLink },
  { type: 'list', label: 'List', icon: List },
  { type: 'location', label: 'Location', icon: MapPin },
  { type: 'flow', label: 'Flow', icon: Workflow },
];

/** Problems the server would reject, phrased for people. */
export function validateResponse(type: ResponseType, r: AnyResponse): string | null {
  const headerOk = (h?: Header) =>
    !h || h.type === 'none' || (h.type === 'text' ? !!h.text?.trim() : !!h.url);
  switch (type) {
    case 'text':
      return (r as TextResponse).body.trim() ? null : 'Write the message body.';
    case 'file':
      return (r as FileResponse).url ? null : 'Upload a file or paste its link.';
    case 'quick_reply': {
      const q = r as QuickReplyResponse;
      if (!headerOk(q.header)) return 'Fill in the header or set it to None.';
      if (!q.body.trim()) return 'Write the message body.';
      if (q.buttons.some((b) => !b.title.trim())) return 'Every button needs a title.';
      return null;
    }
    case 'cta_url': {
      const c = r as CtaUrlResponse;
      if (!headerOk(c.header)) return 'Fill in the header or set it to None.';
      if (!c.body.trim()) return 'Write the message body.';
      if (!c.display_text.trim()) return 'Add the button text.';
      if (!/^https?:\/\//i.test(c.url.trim())) return 'The button link must start with http:// or https://';
      return null;
    }
    case 'list': {
      const l = r as ListResponse;
      if (!l.body.trim()) return 'Write the message body.';
      if (!l.button_text.trim()) return 'Add the menu button text.';
      if (l.sections.some((s) => !s.title.trim())) return 'Every section needs a title.';
      if (l.sections.some((s) => s.rows.some((row) => !row.title.trim()))) return 'Every row needs a title.';
      return null;
    }
    case 'location': {
      const loc = r as LocationResponse;
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      if (loc.latitude === '' || isNaN(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90.';
      if (loc.longitude === '' || isNaN(lng) || lng < -180 || lng > 180) return 'Longitude must be between -180 and 180.';
      return null;
    }
    case 'flow':
      return (r as FlowRefResponse).flow_id ? null : 'Pick the flow to start.';
  }
}

export function clean(type: ResponseType, r: AnyResponse): AnyResponse {
  if (type === 'location') {
    const loc = r as LocationResponse;
    return { ...loc, latitude: Number(loc.latitude), longitude: Number(loc.longitude) };
  }
  return r;
}

// ── Small building blocks ─────────────────────────

export function BodyField({
  label = 'Body Text',
  value,
  onChange,
  max,
  rows = 5,
  required = true,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  rows?: number;
  required?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insertName = () => {
    const el = ref.current;
    const at = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    onChange(value.slice(0, at) + '{{name}}' + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + 8, at + 8);
    });
  };
  return (
    <div>
      <Field label={label} required={required}>
        <Textarea ref={ref} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Write your message here..." />
      </Field>
      <div className="mt-1.5 flex items-center justify-between">
        <button
          type="button"
          onClick={insertName}
          className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
        >
          + Add Name
        </button>
        <span className={`text-xs ${value.length > max ? 'text-red-600' : 'text-muted'}`}>
          {value.length}/{max}
        </span>
      </div>
    </div>
  );
}

function HeaderField({
  workspaceId,
  header = { type: 'none' },
  onChange,
}: {
  workspaceId: string;
  header?: Header;
  onChange: (h: Header) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Header">
        <Select value={header.type} onChange={(e) => onChange({ type: e.target.value as Header['type'] })}>
          <option value="none">None</option>
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="document">Document</option>
        </Select>
      </Field>
      {header.type === 'text' && (
        <Input
          value={header.text ?? ''}
          maxLength={60}
          onChange={(e) => onChange({ ...header, text: e.target.value })}
          placeholder="Header text (max 60)"
        />
      )}
      {(header.type === 'image' || header.type === 'video' || header.type === 'document') && (
        <MediaPicker
          workspaceId={workspaceId}
          kind={header.type}
          url={header.url}
          filename={header.filename}
          onChange={(v) => onChange({ ...header, ...v })}
        />
      )}
    </div>
  );
}

function FooterField({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <Field label="Footer" counter={[(value ?? '').length, 60]}>
      <Input value={value ?? ''} maxLength={60} onChange={(e) => onChange(e.target.value)} placeholder="Optional" />
    </Field>
  );
}

// ── Per-type forms ────────────────────────────────

export function ResponseForm({
  workspaceId,
  type,
  value,
  onChange,
  inFlow,
}: {
  workspaceId: string;
  type: ResponseType;
  value: AnyResponse;
  onChange: (v: AnyResponse) => void;
  /** Inside the flow builder, where each button gets its own path instead. */
  inFlow?: boolean;
}) {
  switch (type) {
    case 'text': {
      const r = value as TextResponse;
      return <BodyField value={r.body} onChange={(body) => onChange({ body })} max={4096} />;
    }

    case 'file': {
      const r = value as FileResponse;
      return (
        <div className="space-y-4">
          <Field label="File type">
            <Select
              value={r.media_type}
              onChange={(e) => onChange({ ...r, media_type: e.target.value as MediaType, url: '', filename: '' })}
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="document">Document</option>
            </Select>
          </Field>
          <MediaPicker
            workspaceId={workspaceId}
            kind={r.media_type}
            url={r.url}
            filename={r.filename}
            onChange={(v) => onChange({ ...r, ...v })}
          />
          {r.media_type === 'document' && (
            <Field label="File name shown to customer">
              <Input value={r.filename ?? ''} onChange={(e) => onChange({ ...r, filename: e.target.value })} placeholder="price-list.pdf" />
            </Field>
          )}
          {r.media_type !== 'audio' && (
            <BodyField
              label="Caption"
              required={false}
              rows={3}
              value={r.caption ?? ''}
              onChange={(caption) => onChange({ ...r, caption })}
              max={1024}
            />
          )}
        </div>
      );
    }

    case 'quick_reply': {
      const r = value as QuickReplyResponse;
      const setButton = (i: number, title: string) =>
        onChange({ ...r, buttons: r.buttons.map((b, j) => (j === i ? { ...b, title } : b)) });
      return (
        <div className="space-y-4">
          <HeaderField workspaceId={workspaceId} header={r.header} onChange={(header) => onChange({ ...r, header })} />
          <BodyField value={r.body} onChange={(body) => onChange({ ...r, body })} max={1024} />
          <FooterField value={r.footer} onChange={(footer) => onChange({ ...r, footer })} />
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">
              Buttons <span className="font-normal text-muted">(up to 3)</span>
            </p>
            <div className="space-y-2">
              {r.buttons.map((b, i) => (
                <div key={b.id} className="flex gap-2">
                  <Input value={b.title} maxLength={20} onChange={(e) => setButton(i, e.target.value)} placeholder={`Button ${i + 1} (max 20)`} />
                  {r.buttons.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2.5"
                      onClick={() => onChange({ ...r, buttons: r.buttons.filter((_, j) => j !== i) })}
                      aria-label="Remove button"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {r.buttons.length < 3 && (
              <button
                type="button"
                onClick={() => onChange({ ...r, buttons: [...r.buttons, { id: newId('btn'), title: '' }] })}
                className="mt-2 text-sm font-medium text-slate-700 hover:underline"
              >
                + Add button
              </button>
            )}
            {!inFlow && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
                <Info className="mt-px size-3.5 shrink-0" />
                When a customer taps a button, its title comes back as a message, so another trigger with that title as
                keyword can answer it. For a different reply per button, use a Flow.
              </p>
            )}
          </div>
        </div>
      );
    }

    case 'cta_url': {
      const r = value as CtaUrlResponse;
      return (
        <div className="space-y-4">
          <HeaderField workspaceId={workspaceId} header={r.header} onChange={(header) => onChange({ ...r, header })} />
          <BodyField value={r.body} onChange={(body) => onChange({ ...r, body })} max={1024} />
          <FooterField value={r.footer} onChange={(footer) => onChange({ ...r, footer })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Button text" required counter={[r.display_text.length, 20]}>
              <Input value={r.display_text} maxLength={20} onChange={(e) => onChange({ ...r, display_text: e.target.value })} placeholder="Visit website" />
            </Field>
            <Field label="Button link" required>
              <Input type="url" value={r.url} onChange={(e) => onChange({ ...r, url: e.target.value })} placeholder="https://" />
            </Field>
          </div>
        </div>
      );
    }

    case 'list': {
      const r = value as ListResponse;
      const totalRows = r.sections.reduce((n, s) => n + s.rows.length, 0);
      const setSection = (i: number, patch: Partial<ListResponse['sections'][number]>) =>
        onChange({ ...r, sections: r.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
      return (
        <div className="space-y-4">
          <Field label="Header" counter={[(r.header_text ?? '').length, 60]}>
            <Input value={r.header_text ?? ''} maxLength={60} onChange={(e) => onChange({ ...r, header_text: e.target.value })} placeholder="Optional" />
          </Field>
          <BodyField value={r.body} onChange={(body) => onChange({ ...r, body })} max={1024} />
          <FooterField value={r.footer} onChange={(footer) => onChange({ ...r, footer })} />
          <Field label="Menu button text" required counter={[r.button_text.length, 20]}>
            <Input value={r.button_text} maxLength={20} onChange={(e) => onChange({ ...r, button_text: e.target.value })} placeholder="View options" />
          </Field>
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              Sections <span className="font-normal text-muted">({totalRows}/10 rows)</span>
            </p>
            {r.sections.map((s, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-line bg-slate-50/50 p-3">
                <div className="flex gap-2">
                  <Input value={s.title} maxLength={24} onChange={(e) => setSection(i, { title: e.target.value })} placeholder={`Section ${i + 1} title (max 24)`} />
                  {r.sections.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2.5 text-red-500"
                      onClick={() => onChange({ ...r, sections: r.sections.filter((_, j) => j !== i) })}
                      aria-label="Remove section"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                {s.rows.map((row, k) => (
                  <div key={row.id} className="ml-3 flex gap-2 border-l-2 border-line pl-3">
                    <div className="grid flex-1 gap-2 sm:grid-cols-2">
                      <Input
                        value={row.title}
                        maxLength={24}
                        onChange={(e) => setSection(i, { rows: s.rows.map((x, m) => (m === k ? { ...x, title: e.target.value } : x)) })}
                        placeholder="Row title (max 24)"
                      />
                      <Input
                        value={row.description ?? ''}
                        maxLength={72}
                        onChange={(e) => setSection(i, { rows: s.rows.map((x, m) => (m === k ? { ...x, description: e.target.value } : x)) })}
                        placeholder="Description (optional)"
                      />
                    </div>
                    {s.rows.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="px-2.5"
                        onClick={() => setSection(i, { rows: s.rows.filter((_, m) => m !== k) })}
                        aria-label="Remove row"
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {totalRows < 10 && (
                  <button
                    type="button"
                    onClick={() => setSection(i, { rows: [...s.rows, { id: newId('row'), title: '', description: '' }] })}
                    className="ml-3 text-sm font-medium text-slate-700 hover:underline"
                  >
                    + Add row
                  </button>
                )}
              </div>
            ))}
            {totalRows < 10 && (
              <button
                type="button"
                onClick={() =>
                  onChange({ ...r, sections: [...r.sections, { title: '', rows: [{ id: newId('row'), title: '', description: '' }] }] })
                }
                className="text-sm font-medium text-slate-700 hover:underline"
              >
                + Add section
              </button>
            )}
          </div>
        </div>
      );
    }

    case 'location': {
      const r = value as LocationResponse;
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Latitude" required>
              <Input inputMode="decimal" value={String(r.latitude)} onChange={(e) => onChange({ ...r, latitude: e.target.value })} placeholder="19.0760" />
            </Field>
            <Field label="Longitude" required>
              <Input inputMode="decimal" value={String(r.longitude)} onChange={(e) => onChange({ ...r, longitude: e.target.value })} placeholder="72.8777" />
            </Field>
          </div>
          <Field label="Place name">
            <Input value={r.name ?? ''} onChange={(e) => onChange({ ...r, name: e.target.value })} placeholder="Sigmaflux Office" />
          </Field>
          <Field label="Address">
            <Textarea rows={2} value={r.address ?? ''} onChange={(e) => onChange({ ...r, address: e.target.value })} />
          </Field>
          <p className="text-xs text-muted">Tip: in Google Maps, right-click a spot to copy its coordinates.</p>
        </div>
      );
    }

    case 'flow':
      return (
        <FlowPicker
          workspaceId={workspaceId}
          value={(value as FlowRefResponse).flow_id}
          onChange={(flow_id) => onChange({ flow_id })}
        />
      );
  }
}


function FlowPicker({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { data, isLoading } = useQuery({ queryKey: ['flows', workspaceId], queryFn: () => endpoints.flows(workspaceId) });
  const selected = data?.find((f) => f.id === value);
  return (
    <div className="space-y-2">
      <Field label="Select Flow" required>
        <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={isLoading}>
          <option value="">{isLoading ? 'Loading flows…' : 'Choose a flow'}</option>
          {data?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.status === 'draft' ? ' (draft)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      {selected?.status === 'draft' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This flow is a draft, so it won&apos;t run until you set it to Active in the Flow Builder.
        </p>
      )}
      <p className="text-xs text-muted">
        The flow starts when this trigger fires.{' '}
        {value ? (
          <Link href={`/flows/${value}`} className="font-medium text-slate-700 underline-offset-2 hover:underline">
            Open in Flow Builder
          </Link>
        ) : (
          <Link href="/flows" className="font-medium text-slate-700 underline-offset-2 hover:underline">
            Create a flow
          </Link>
        )}
      </p>
    </div>
  );
}
