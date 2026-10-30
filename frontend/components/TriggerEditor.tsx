'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Info, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  endpoints,
  type AnyResponse,
  type MatchType,
  type ResponseType,
  type Trigger,
  type TriggerInput,
} from '@/lib/api';
import ResponsePreview from './ResponsePreview';
import { clean, defaults, RESPONSE_TYPES, ResponseForm, type Responses, validateResponse } from './ResponseForm';
import { Button, Card, ErrorText, Field, Input, Toggle } from './ui';

const MATCH_TYPES: { type: MatchType; label: string }[] = [
  { type: 'contains', label: 'Contains' },
  { type: 'equals', label: 'Equal to' },
  { type: 'any', label: 'Any message' },
];

/** Problems the server would reject, phrased for people. */
function validate(name: string, match: MatchType, keywords: string[], type: ResponseType, r: AnyResponse): string | null {
  if (!name.trim()) return 'Give the trigger a name.';
  if (match !== 'any' && keywords.length === 0) return 'Add at least one keyword.';
  return validateResponse(type, r);
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
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 2xl:grid-cols-7">
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
