'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ExternalLink,
  File as FileIcon,
  Info,
  List,
  MapPin,
  Plus,
  Reply,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  endpoints,
  type AnyResponse,
  type CtaUrlResponse,
  type FileResponse,
  type Header,
  type ListResponse,
  type LocationResponse,
  type MatchType,
  type MediaType,
  type QuickReplyResponse,
  type ResponseType,
  type TextResponse,
  type Trigger,
  type TriggerInput,
} from '@/lib/api';
import MediaPicker from './MediaPicker';
import ResponsePreview from './ResponsePreview';
import { Button, Card, ErrorText, Field, Input, Select, Textarea, Toggle } from './ui';

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Responses = {
  text: TextResponse;
  file: FileResponse;
  quick_reply: QuickReplyResponse;
  cta_url: CtaUrlResponse;
  list: ListResponse;
  location: LocationResponse;
};

const defaults = (): Responses => ({
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
});

const RESPONSE_TYPES: { type: ResponseType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'file', label: 'File', icon: FileIcon },
  { type: 'quick_reply', label: 'Quick Reply', icon: Reply },
  { type: 'cta_url', label: 'CTA URL', icon: ExternalLink },
  { type: 'list', label: 'List', icon: List },
  { type: 'location', label: 'Location', icon: MapPin },
];

const MATCH_TYPES: { type: MatchType; label: string }[] = [
  { type: 'contains', label: 'Contains' },
  { type: 'equals', label: 'Equal to' },
  { type: 'any', label: 'Any message' },
];

/** Problems the server would reject, phrased for people. */
function validate(name: string, match: MatchType, keywords: string[], type: ResponseType, r: AnyResponse): string | null {
  if (!name.trim()) return 'Give the trigger a name.';
  if (match !== 'any' && keywords.length === 0) return 'Add at least one keyword.';
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
  }
}

function clean(type: ResponseType, r: AnyResponse): AnyResponse {
  if (type === 'location') {
    const loc = r as LocationResponse;
    return { ...loc, latitude: Number(loc.latitude), longitude: Number(loc.longitude) };
  }
  return r;
}

// ── Small building blocks ─────────────────────────

function BodyField({
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

function ResponseForm({
  workspaceId,
  type,
  value,
  onChange,
}: {
  workspaceId: string;
  type: ResponseType;
  value: AnyResponse;
  onChange: (v: AnyResponse) => void;
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
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
              <Info className="mt-px size-3.5 shrink-0" />
              When a customer taps a button, its title comes back as a message, so another trigger with that title as
              keyword can answer it.
            </p>
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
  }
}

// ── Editor ────────────────────────────────────────

export default function TriggerEditor({ workspaceId, trigger }: { workspaceId: string; trigger?: Trigger }) {
  const router = useRouter();
  const qc = useQueryClient();

  const [name, setName] = useState(trigger?.name ?? '');
  const [matchType, setMatchType] = useState<MatchType>(trigger?.match_type ?? 'equals');
  const [keywords, setKeywords] = useState<string[]>(trigger?.keywords ?? []);
  const [draft, setDraft] = useState('');
  const [useSource, setUseSource] = useState(!!trigger?.source);
  const [source, setSource] = useState(trigger?.source ?? '');
  const [responseType, setResponseType] = useState<ResponseType>(trigger?.response_type ?? 'text');
  // One draft per type, so switching type and back doesn't lose work.
  const [responses, setResponses] = useState<Responses>(() => {
    const d = defaults();
    return trigger ? { ...d, [trigger.response_type]: { ...d[trigger.response_type], ...trigger.response } } : d;
  });
  const [isActive, setIsActive] = useState(trigger?.is_active ?? true);
  const [formError, setFormError] = useState<string | null>(null);

  const addKeyword = () => {
    const parts = draft.split(',').map((k) => k.trim()).filter(Boolean);
    if (!parts.length) return;
    setKeywords((ks) => [...ks, ...parts.filter((p) => !ks.some((k) => k.toLowerCase() === p.toLowerCase()))]);
    setDraft('');
  };

  const save = useMutation({
    mutationFn: (body: TriggerInput) =>
      trigger ? endpoints.updateTrigger(workspaceId, trigger.id, body) : endpoints.createTrigger(workspaceId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['triggers', workspaceId] });
      router.push('/auto-reply');
    },
  });

  const submit = () => {
    // A keyword typed but not yet added counts.
    const allKeywords = draft.trim() ? [...keywords, ...draft.split(',').map((k) => k.trim()).filter(Boolean)] : keywords;
    const response = responses[responseType];
    const problem = validate(name, matchType, allKeywords, responseType, response);
    setFormError(problem);
    if (problem) return;
    save.mutate({
      name: name.trim(),
      match_type: matchType,
      keywords: matchType === 'any' ? [] : allKeywords,
      source: useSource ? source.trim() || null : null,
      response_type: responseType,
      response: clean(responseType, response),
      is_active: isActive,
    });
  };

  const response = responses[responseType];

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-8">
      <div className="mb-6 flex items-center gap-4 border-b border-line pb-4">
        <Link href="/auto-reply" className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ChevronLeft className="size-4" /> Back
        </Link>
        <h1 className="font-semibold text-slate-900">{trigger ? 'Edit Auto Reply' : 'Create Auto Reply'}</h1>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card step={1} title="Trigger Condition" subtitle="When should this auto reply fire?">
          <div className="space-y-5">
            <Field label="Flow name" required hint="Only for you, to find this trigger later.">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pest control" />
            </Field>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Match type</p>
              <div className="flex flex-wrap gap-2">
                {MATCH_TYPES.map((m) => (
                  <button
                    key={m.type}
                    type="button"
                    onClick={() => setMatchType(m.type)}
                    className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                      matchType === m.type ? 'border-ink bg-ink text-white' : 'border-line bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                {matchType === 'equals' && 'Fires when the whole message is one of the keywords. Case and extra spaces are ignored.'}
                {matchType === 'contains' && 'Fires when the message includes one of the keywords anywhere.'}
                {matchType === 'any' && 'Fires for any message no other trigger answers.'}
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="size-4 accent-slate-800" checked={useSource} onChange={(e) => setUseSource(e.target.checked)} />
                Add Source
                <span title="Only fire for chats that came from this source, e.g. a Facebook or Instagram ad.">
                  <Info className="size-3.5 text-slate-400" />
                </span>
              </label>
              {useSource && (
                <div className="mt-2">
                  <Input list="sources" value={source} onChange={(e) => setSource(e.target.value)} placeholder="facebook" />
                  <datalist id="sources">
                    <option value="facebook" />
                    <option value="instagram" />
                    <option value="whatsapp" />
                  </datalist>
                  <p className="mt-1 text-xs text-muted">Matched against the ad / referral source GetGabs reports.</p>
                </div>
              )}
            </div>

            {matchType !== 'any' && (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Keywords</p>
                <div className="flex gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addKeyword();
                      }
                    }}
                    placeholder="Type a keyword and press Enter"
                  />
                  <Button type="button" variant="secondary" onClick={addKeyword}>
                    <Plus className="size-4" /> Add
                  </Button>
                </div>
                {keywords.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {keywords.map((k) => (
                      <span key={k} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pr-1.5 pl-3 text-sm text-slate-800">
                        {k}
                        <button
                          type="button"
                          onClick={() => setKeywords((ks) => ks.filter((x) => x !== k))}
                          className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                          aria-label={`Remove ${k}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">No keywords added yet. Separate several with commas.</p>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card step={2} title="Add Action" subtitle="What should happen when triggered?">
          <p className="mb-2 text-sm font-medium text-slate-700">Response type</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {RESPONSE_TYPES.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => setResponseType(type)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition-colors ${
                  responseType === type
                    ? 'border-slate-400 bg-slate-100 text-slate-900'
                    : 'border-line bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </div>
          <hr className="my-5 border-line" />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <ResponseForm
              workspaceId={workspaceId}
              type={responseType}
              value={response}
              onChange={(v) => setResponses((rs) => ({ ...rs, [responseType]: v }))}
            />
            <div className="xl:sticky xl:top-4 xl:self-start">
              <ResponsePreview type={responseType} response={response} />
            </div>
          </div>
        </Card>
      </div>

      <div className="fixed right-0 bottom-0 left-0 z-20 border-t border-line bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-8">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Toggle checked={isActive} onChange={setIsActive} label="Active" />
            {isActive ? 'Active' : 'Inactive'}
          </label>
          <div className="min-w-0 flex-1">
            <ErrorText error={formError ?? save.error} />
          </div>
          <Link href="/auto-reply">
            <Button variant="secondary">Cancel</Button>
          </Link>
          <Button onClick={submit} loading={save.isPending}>
            {trigger ? 'Save changes' : 'Create trigger'}
          </Button>
        </div>
      </div>
    </div>
  );
}
