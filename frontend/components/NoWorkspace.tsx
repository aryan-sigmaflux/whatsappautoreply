import { Settings2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from './ui';

export default function NoWorkspace() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <Settings2 className="mx-auto size-8 text-slate-400" />
      <p className="mt-3 font-medium text-slate-800">Connect a GetGabs account first</p>
      <p className="mt-1 text-sm text-muted">Auto replies belong to an account. Set one up to get its webhook URL.</p>
      <Link href="/setup">
        <Button className="mt-5">Go to Setup</Button>
      </Link>
    </div>
  );
}
