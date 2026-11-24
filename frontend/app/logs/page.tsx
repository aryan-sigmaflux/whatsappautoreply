'use client';

import AppShell, { useWorkspaces } from '@/components/AppShell';
import { LogView } from '@/components/LogView';
import NoWorkspace from '@/components/NoWorkspace';
import { ErrorText, Spinner } from '@/components/ui';

function LogsPage() {
  const { current, isLoading, error } = useWorkspaces();
  if (isLoading) return <Spinner />;
  if (error)
    return (
      <div className="p-8">
        <ErrorText error={error} />
      </div>
    );
  if (!current) return <NoWorkspace />;
  return <LogView key={current.id} ws={current} />;
}

export default function Page() {
  return (
    <AppShell>
      <LogsPage />
    </AppShell>
  );
}
