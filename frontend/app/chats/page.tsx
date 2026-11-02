'use client';

import { MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import AppShell, { useWorkspaces } from '@/components/AppShell';
import { ChatConversation, ChatList } from '@/components/ChatView';
import NoWorkspace from '@/components/NoWorkspace';
import { ErrorText, Spinner } from '@/components/ui';
import type { Workspace } from '@/lib/api';

function Chats({ ws }: { ws: Workspace }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="flex h-full">
      <div className={`w-full border-r border-line bg-white lg:block lg:w-96 ${selected ? 'hidden' : 'block'}`}>
        <ChatList workspaceId={ws.id} selected={selected} onSelect={setSelected} />
      </div>
      <div className={`min-w-0 flex-1 lg:block ${selected ? 'block' : 'hidden'}`}>
        {selected ? (
          <ChatConversation key={selected} workspaceId={ws.id} chatId={selected} onBack={() => setSelected(null)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-wa-bg/40 text-center">
            <MessagesSquare className="size-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-700">Pick a chat</p>
            <p className="mt-1 max-w-xs text-sm text-muted">
              You can reply by hand while the contact&apos;s last message is less than 24 hours old.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatsPage() {
  const { current, isLoading, error } = useWorkspaces();
  if (isLoading) return <Spinner />;
  if (error)
    return (
      <div className="p-8">
        <ErrorText error={error} />
      </div>
    );
  if (!current) return <NoWorkspace />;
  return <Chats key={current.id} ws={current} />;
}

export default function Page() {
  return (
    <AppShell>
      <ChatsPage />
    </AppShell>
  );
}
