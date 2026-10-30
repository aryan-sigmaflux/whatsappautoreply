'use client';

import { Info, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { AnyResponse, FlowNodeData, QuestionCase, SendType } from '@/lib/api';
import { BodyField, defaults, newId, ResponseForm } from '../ResponseForm';
import { MessageBubble } from '../ResponsePreview';
import { Button, Field, Input, Select } from '../ui';
import { nodeProblem, SEND_LABEL, type BuilderNode } from './nodes';

function KeywordChips({ keywords, onChange }: { keywords: string[]; onChange: (k: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((k) => k.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...keywords, ...parts.filter((p) => !keywords.some((k) => k.toLowerCase() === p.toLowerCase()))]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Type a keyword, press Enter"
        />
      </div>
      {keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {keywords.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-2.5 text-xs text-slate-800">
              {k}
              <button
                type="button"
                onClick={() => onChange(keywords.filter((x) => x !== k))}
                className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                aria-label={`Remove ${k}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionForm({ data, onChange }: { data: FlowNodeData; onChange: (d: FlowNodeData) => void }) {
  const cases = data.cases ?? [];
  const setCase = (i: number, patch: Partial<QuestionCase>) =>
    onChange({ ...data, cases: cases.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-4">
      <BodyField label="Question" value={data.body ?? ''} onChange={(body) => onChange({ ...data, body })} max={4096} rows={4} />
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">Reply options</p>
        <p className="mb-3 text-xs text-muted">
          Each option is its own path. They&apos;re checked top to bottom; anything that matches none of them takes the default
          path.
        </p>
        <div className="space-y-3">
          {cases.map((c, i) => (
            <div key={c.id} className="space-y-2 rounded-xl border border-line bg-slate-50/50 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500">If the reply</span>
                <Select
                  value={c.match_type}
                  onChange={(e) => setCase(i, { match_type: e.target.value as QuestionCase['match_type'] })}
                  className="w-auto py-1"
                >
                  <option value="equals">is exactly</option>
                  <option value="contains">contains</option>
                </Select>
                <button
                  type="button"
                  onClick={() => onChange({ ...data, cases: cases.filter((_, j) => j !== i) })}
                  className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-red-600"
                  aria-label="Remove option"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <KeywordChips keywords={c.keywords} onChange={(keywords) => setCase(i, { keywords })} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...data, cases: [...cases, { id: newId('case'), match_type: 'equals', keywords: [] }] })}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:underline"
        >
          <Plus className="size-4" /> Add reply option
        </button>
      </div>
    </div>
  );
}

const TITLES = { start: 'Trigger', buttons: 'Quick Reply', list: 'Interactive List', question: 'Question' } as const;

export default function NodeEditor({
  workspaceId,
  node,
  onChange,
  onDelete,
  onClose,
}: {
  workspaceId: string;
  node: BuilderNode;
  onChange: (data: FlowNodeData) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { data, type } = node;
  const title = type === 'send' ? SEND_LABEL[data.response_type ?? 'text'].label : TITLES[type as keyof typeof TITLES];
  const problem = nodeProblem(type, data);

  let preview: { t: 'text' | SendType | 'quick_reply' | 'list'; r: AnyResponse } | null = null;
  if (type === 'send' && data.response_type && data.response) preview = { t: data.response_type, r: data.response };
  if (type === 'buttons' && data.response) preview = { t: 'quick_reply', r: data.response };
  if (type === 'list' && data.response) preview = { t: 'list', r: data.response };
  if (type === 'question') preview = { t: 'text', r: { body: data.body ?? '' } };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 className="flex-1 font-semibold text-slate-900">{title}</h2>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
          <X className="size-5" />
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {type === 'start' && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>This is where the flow begins. Connect it to the first step.</p>
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs">
              <Info className="mt-0.5 size-4 shrink-0 text-slate-400" />
              To start this flow from a keyword, go to Auto Reply, create a keyword trigger and choose Flow as the response.
            </p>
          </div>
        )}

        {type === 'send' && (
          <>
            <Field label="Message type">
              <Select
                value={data.response_type}
                onChange={(e) => {
                  const t = e.target.value as SendType;
                  onChange({ response_type: t, response: defaults()[t] });
                }}
              >
                <option value="text">Text</option>
                <option value="file">Media / File</option>
                <option value="cta_url">CTA URL Button</option>
                <option value="location">Location</option>
              </Select>
            </Field>
            <ResponseForm
              workspaceId={workspaceId}
              type={data.response_type ?? 'text'}
              value={data.response ?? defaults().text}
              onChange={(response) => onChange({ ...data, response })}
            />
          </>
        )}

        {(type === 'buttons' || type === 'list') && (
          <ResponseForm
            workspaceId={workspaceId}
            type={type === 'buttons' ? 'quick_reply' : 'list'}
            inFlow
            value={data.response ?? defaults()[type === 'buttons' ? 'quick_reply' : 'list']}
            onChange={(response) => onChange({ ...data, response })}
          />
        )}

        {type === 'question' && <QuestionForm data={data} onChange={onChange} />}

        {(type === 'buttons' || type === 'list') && (
          <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <Info className="mt-0.5 size-4 shrink-0 text-slate-400" />
            Each option gets its own connection point on the canvas. Typing the option&apos;s title counts as choosing it.
            Anything else takes &quot;No match / default&quot;.
          </p>
        )}

        {preview && (
          <div className="rounded-xl bg-wa-bg p-4">
            <p className="mb-2 text-center text-[11px] text-slate-500">Preview</p>
            <MessageBubble type={preview.t} response={preview.r} />
          </div>
        )}
      </div>
      {type !== 'start' && (
        <div className="flex items-center gap-3 border-t border-line px-5 py-3">
          <p className={`flex-1 text-xs ${problem ? 'text-amber-700' : 'text-emerald-700'}`}>{problem ?? 'Ready'}</p>
          <Button variant="ghost" className="text-red-600" onClick={onDelete}>
            <Trash2 className="size-4" /> Delete step
          </Button>
        </div>
      )}
    </div>
  );
}
