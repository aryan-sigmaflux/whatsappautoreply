'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AppShell, { useWorkspaces } from '@/components/AppShell';
import NoWorkspace from '@/components/NoWorkspace';
import TriggerEditor from '@/components/TriggerEditor';
import { ErrorText, Spinner } from '@/components/ui';
import { endpoints } from '@/lib/api';

function EditTrigger() {
  const { id } = useParams<{ id: string }>();
  const { current, isLoading: wsLoading } = useWorkspaces();
  const { data, isLoading, error } = useQuery({
    queryKey: ['trigger', current?.id, id],
    queryFn: () => endpoints.trigger(current!.id, id),
    enabled: !!current,
    // Always edit the saved version, not a cached one.
    gcTime: 0,
  });

  if (wsLoading || (current && isLoading)) return <Spinner />;
  if (!current) return <NoWorkspace />;
  if (error || !data)
    return (
      <div className="mx-auto max-w-xl space-y-4 p-8">
        <ErrorText error={error ?? 'Trigger not found in this account.'} />
        <Link href="/auto-reply" className="text-sm font-medium text-slate-700 underline">
          Back to Auto Reply
        </Link>
      </div>
    );
  return <TriggerEditor key={data.id} workspaceId={current.id} trigger={data} />;
}

export default function Page() {
  return (
    <AppShell>
      <EditTrigger />
    </AppShell>
  );
}
