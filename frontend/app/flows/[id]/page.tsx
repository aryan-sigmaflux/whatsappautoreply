'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AppShell, { useWorkspaces } from '@/components/AppShell';
import FlowBuilder from '@/components/flow/FlowBuilder';
import NoWorkspace from '@/components/NoWorkspace';
import { ErrorText, Spinner } from '@/components/ui';
import { endpoints } from '@/lib/api';

function EditFlow() {
  const { id } = useParams<{ id: string }>();
  const { current, isLoading: wsLoading } = useWorkspaces();
  const { data, isLoading, error } = useQuery({
    queryKey: ['flow', current?.id, id],
    queryFn: () => endpoints.flow(current!.id, id),
    enabled: !!current,
    // Always open the saved version, not a cached one.
    gcTime: 0,
  });

  if (wsLoading || (current && isLoading)) return <Spinner />;
  if (!current) return <NoWorkspace />;
  if (error || !data)
    return (
      <div className="mx-auto max-w-xl space-y-4 p-8">
        <ErrorText error={error ?? 'Flow not found in this account.'} />
        <Link href="/flows" className="text-sm font-medium text-slate-700 underline">
          Back to Flow Builder
        </Link>
      </div>
    );
  return <FlowBuilder key={data.id} workspaceId={current.id} flow={data} />;
}

export default function Page() {
  return (
    <AppShell bare>
      <EditFlow />
    </AppShell>
  );
}
