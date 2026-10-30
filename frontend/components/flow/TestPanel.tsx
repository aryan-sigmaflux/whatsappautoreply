'use client';

import { useMutation } from '@tanstack/react-query';
import { Info, RotateCcw, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { endpoints, type FlowGraph, type ListResponse, type QuickReplyResponse, type SimulateResult } from '@/lib/api';
import { MessageBubble } from '../ResponsePreview';
import { ErrorText } from '../ui';

type ChatItem =
  | { kind: 'bot'; output: SimulateResult['outputs'][number] }
  | { kind: 'user'; text: string }
  | { kind: 'note'; text: string };

export default function TestPanel({
  workspaceId,
  flowId,
  getGraph,
  onWaitingChange,
  onClose,
}: {
  workspaceId: string;
  flowId: string;
  /** The graph as it is on the canvas right now, saved or not. */
  getGraph: () => FlowGraph;
  onWaitingChange: (nodeId: string | null) => void;
  onClose: () => void;
}) {
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const step = useMutation({
    mutationFn: (vars: { waiting: string | null; message: string }) =>
      endpoints.simulateFlow(workspaceId, flowId, { graph: getGraph(), waiting_node_id: vars.waiting, message: vars.message }),
    onSuccess: (res) => {
      setChat((c) => [
        ...c,
        ...res.outputs.map((o) => ({ kind: 'bot' as const, output: o })),
        ...(res.note ? [{ kind: 'note' as const, text: res.note }] : []),
      ]);
      setWaiting(res.waiting_node_id);
      setEnded(res.waiting_node_id === null);
      onWaitingChange(res.waiting_node_id);
    },
  });

  const restart = () => {
    setChat([]);
    setEnded(false);
    step.mutate({ waiting: null, message: '' });
  };

  // Start as soon as the panel opens (state is already empty then).
  const { mutate } = step;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate({ waiting: null, message: '' });
  }, [mutate]);
  useEffect(() => () => onWaitingChange(null), [onWaitingChange]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const reply = (message: string) => {
    if (!message.trim() || !waiting) return;
    setChat((c) => [...c, { kind: 'user', text: message }]);
    setText('');
    step.mutate({ waiting, message });
  };

  // Tappable options for the step waiting on the customer.
  const last = [...chat].reverse().find((c) => c.kind === 'bot');
  let options: string[] = [];
  if (waiting && last?.kind === 'bot' && last.output.node_id === waiting) {
    if (last.output.response_type === 'quick_reply') options = (last.output.response as QuickReplyResponse).buttons.map((b) => b.title);
    if (last.output.response_type === 'list')
      options = (last.output.response as ListResponse).sections.flatMap((s) => s.rows.map((r) => r.title));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <div className="flex-1">
          <h2 className="font-semibold text-slate-900">Test flow</h2>
          <p className="text-xs text-muted">Uses what&apos;s on the canvas, saved or not. Nothing is sent.</p>
        </div>
        <button onClick={restart} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" title="Restart">
          <RotateCcw className="size-4" />
        </button>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-wa-bg p-4">
        {chat.map((item, i) =>
          item.kind === 'bot' ? (
            <MessageBubble key={i} type={item.output.response_type} response={item.output.response} />
          ) : item.kind === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[240px] rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 text-[13px] whitespace-pre-wrap text-slate-800 shadow-sm">
                {item.text}
              </p>
            </div>
          ) : (
            <p key={i} className="mx-auto flex max-w-[300px] items-start gap-1.5 rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-600">
              <Info className="mt-px size-3.5 shrink-0 text-slate-400" />
              {item.text}
            </p>
          ),
        )}
        <ErrorText error={step.error} />
        <div ref={bottom} />
      </div>

      <div className="space-y-2 border-t border-line p-3">
        {options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
              <button
                key={o}
                onClick={() => reply(o)}
                className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
              >
                {o}
              </button>
            ))}
          </div>
        )}
        {ended ? (
          <button onClick={restart} className="w-full rounded-lg border border-line py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Flow ended · Restart test
          </button>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              reply(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={waiting ? 'Reply as the customer…' : 'Starting…'}
              disabled={!waiting || step.isPending}
              className="flex-1 rounded-full border border-line bg-white px-4 py-2 text-sm outline-none focus:border-slate-400"
            />
            <button
              type="submit"
              disabled={!waiting || !text.trim() || step.isPending}
              className="flex size-9 items-center justify-center rounded-full bg-emerald-600 text-white disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="size-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
