'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, FileText, Lock, MessagesSquare, Paperclip, Reply, Search, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { endpoints, timeAgo, type AnyResponse, type Chat, type ChatMessage, type MediaType, type ResponseType } from '@/lib/api';
import { MessageBubble } from './ResponsePreview';
import { ErrorText, Input, Spinner } from './ui';

const LIST_POLL_MS = 10_000;
const CHAT_POLL_MS = 5_000;

function chatTitle(c: Chat) {
  return c.name || `+${c.contact}`;
}

function initials(c: Chat) {
  const parts = c.name.split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') : '#';
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function day(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "5h 12m" until the 24-hour window closes. */
function timeLeft(iso: string) {
  const mins = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

function mediaType(file: File): MediaType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}

// ── List ───────────────────────────────────────────

export function ChatList({
  workspaceId,
  selected,
  onSelect,
}: {
  workspaceId: string;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const [search, setSearch] = useState('');
  const q = search.trim();
  const { data, isLoading, error } = useQuery({
    queryKey: ['chats', workspaceId, q],
    queryFn: () => endpoints.chats(workspaceId, q),
    refetchInterval: LIST_POLL_MS,
    placeholderData: (previous) => previous, // keep the list on screen while a search loads
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4">
        <h1 className="text-xl font-semibold text-slate-900">Chats</h1>
        <p className="mt-0.5 text-xs text-muted">Contacts who started a flow</p>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or number..." className="pl-9" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4">
            <ErrorText error={error} />
          </div>
        ) : !data?.length ? (
          <div className="px-6 py-16 text-center">
            <MessagesSquare className="mx-auto size-8 text-slate-400" />
            <p className="mt-3 font-medium text-slate-800">{q ? 'No chats match' : 'No chats yet'}</p>
            {!q && <p className="mt-1 text-sm text-muted">A chat appears here once a flow runs for a contact.</p>}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
                    selected === c.id ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                    {initials(c)}
                    {c.window_open && (
                      <span
                        className="absolute right-0 bottom-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
                        title="24-hour window open"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{chatTitle(c)}</span>
                      <span className="shrink-0 text-xs text-slate-400">{timeAgo(c.last_message_at)}</span>
                    </span>
                    <span className="block truncate text-sm text-muted">{c.last_preview || ' '}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── One message ────────────────────────────────────

function Inbound({ m }: { m: ChatMessage }) {
  const c = m.content as { text?: string; message_type?: string; url?: string };
  return (
    <div className="max-w-[320px] rounded-lg rounded-tl-none bg-white px-2.5 py-2 text-[13px] leading-snug text-slate-800 shadow-sm">
      {m.kind === 'media' ? (
        <a
          href={c.url || undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2.5 text-xs text-slate-600 hover:bg-slate-200"
        >
          <FileText className="size-5 shrink-0 text-slate-500" />
          <span className="capitalize">{c.message_type || 'Media'}</span>
          {c.url && <span className="text-sky-600">Open</span>}
        </a>
      ) : (
        <p className="whitespace-pre-wrap break-words">
          {m.kind === 'button' && <Reply className="mr-1 inline size-3.5 text-slate-400" />}
          {c.text}
        </p>
      )}
      <p className="mt-0.5 text-right text-[10px] text-slate-400">{clock(m.created_at)}</p>
    </div>
  );
}

function Outbound({ m }: { m: ChatMessage }) {
  return (
    <div className="flex flex-col items-end">
      <MessageBubble
        type={m.kind as ResponseType}
        response={m.content as unknown as AnyResponse}
        outgoing
        time={clock(m.created_at)}
      />
      <p className={`mt-0.5 max-w-[320px] text-right text-[11px] ${m.error ? 'text-red-600' : 'text-slate-400'}`}>
        {m.error ? `Not delivered: ${m.error}` : m.sent_by}
      </p>
    </div>
  );
}

// ── Conversation ───────────────────────────────────

function Composer({ workspaceId, chat }: { workspaceId: string; chat: Chat }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const send = useMutation({
    mutationFn: async () => {
      const caption = text.trim();
      if (file) {
        const up = await endpoints.upload(workspaceId, file);
        const kind = mediaType(file);
        return endpoints.sendChatMessage(workspaceId, chat.id, {
          response_type: 'file',
          response: {
            media_type: kind,
            url: up.url,
            filename: kind === 'document' ? up.filename : undefined,
            caption: kind !== 'audio' && caption ? caption : undefined,
          },
        });
      }
      return endpoints.sendChatMessage(workspaceId, chat.id, { response_type: 'text', response: { body: text } });
    },
    onSuccess: () => {
      setText('');
      setFile(null);
      qc.invalidateQueries({ queryKey: ['chat', workspaceId, chat.id] });
      qc.invalidateQueries({ queryKey: ['chats', workspaceId] });
    },
  });
  const canSend = (!!text.trim() || !!file) && !send.isPending;

  if (!chat.window_open) {
    return (
      <div className="flex items-start gap-2.5 border-t border-line bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <Lock className="mt-0.5 size-4 shrink-0 text-slate-400" />
        <p>
          The 24-hour window is closed
          {chat.window_closes_at ? ` (${timeAgo(chat.window_closes_at)})` : ''}. WhatsApp only lets you reply after{' '}
          {chat.name || 'the contact'} sends a new message.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-line bg-white p-3">
      {file && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          <Paperclip className="size-4 shrink-0 text-slate-500" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button onClick={() => setFile(null)} className="rounded p-0.5 text-slate-500 hover:bg-slate-200" aria-label="Remove file">
            <X className="size-4" />
          </button>
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) send.mutate();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          title="Attach a file"
        >
          <Paperclip className="size-5" />
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) send.mutate();
            }
          }}
          rows={1}
          maxLength={file ? 1024 : 4096}
          placeholder={file ? 'Add a caption (optional)' : 'Type a message'}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-line bg-white px-4 py-2 text-sm outline-none [field-sizing:content] focus:border-slate-400"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white disabled:opacity-40"
          aria-label="Send"
        >
          {send.isPending ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Send className="size-4" />}
        </button>
      </form>
      <ErrorText error={send.error} />
    </div>
  );
}

export function ChatConversation({ workspaceId, chatId, onBack }: { workspaceId: string; chatId: number; onBack: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['chat', workspaceId, chatId],
    queryFn: () => endpoints.chat(workspaceId, chatId),
    refetchInterval: CHAT_POLL_MS,
  });
  const bottom = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [count, chatId]);

  if (isLoading) return <Spinner />;
  if (error || !data)
    return (
      <div className="p-6">
        <ErrorText error={error} />
      </div>
    );

  const { chat, messages } = data;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
        <button onClick={onBack} className="rounded-md p-1.5 hover:bg-slate-100 lg:hidden" aria-label="Back to chats">
          <ArrowLeft className="size-5" />
        </button>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
          {initials(chat)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-medium text-slate-900">{chatTitle(chat)}</p>
          <p className="truncate text-xs text-muted">+{chat.contact}</p>
        </div>
        {chat.window_open && chat.window_closes_at ? (
          <span
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
            title="You can send messages until the 24-hour window closes"
          >
            <Clock className="size-3.5" /> {timeLeft(chat.window_closes_at)} left
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
            Window closed
          </span>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-wa-bg px-4 py-4">
        {messages.length === 500 && <p className="text-center text-xs text-slate-500">Showing the latest 500 messages</p>}
        {messages.map((m, i) => (
          <div key={m.id}>
            {(i === 0 || day(messages[i - 1]!.created_at) !== day(m.created_at)) && (
              <p className="mx-auto my-3 w-fit rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
                {day(m.created_at)}
              </p>
            )}
            {m.direction === 'in' ? <Inbound m={m} /> : <Outbound m={m} />}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <Composer key={chat.id} workspaceId={workspaceId} chat={chat} />
    </div>
  );
}
