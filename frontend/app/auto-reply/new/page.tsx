'use client';

import AppShell, { useWorkspaces } from '@/components/AppShell';
import NoWorkspace from '@/components/NoWorkspace';
import TriggerEditor from '@/components/TriggerEditor';
import { ErrorText, Spinner } from '@/components/ui';

function NewTrigger() {
  const { current, isLoading, error } = useWorkspaces();
  if (isLoading) return <Spinner />;
  if (error) return <div className="p-8"><ErrorText error={error} /></div>;
  if (!current) return <NoWorkspace />;
  return <TriggerEditor key={current.id} workspaceId={current.id} />;
}

export default function Page() {
  return (
    <AppShell>
      <NewTrigger />
    </AppShell>
  );
}
