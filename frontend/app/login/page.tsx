'use client';

import { useMutation } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ErrorText, Field, Input } from '@/components/ui';
import { endpoints } from '@/lib/api';
import { useSession } from '@/store/session';

export default function LoginPage() {
  const router = useRouter();
  const { token, login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (token) router.replace('/auto-reply');
  }, [token, router]);

  const mutation = useMutation({
    mutationFn: () => endpoints.login(email, password),
    onSuccess: (res) => login(res.access_token, res.user),
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-line bg-white p-8 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand text-white">
            <Zap className="size-5" />
          </span>
          <div className="leading-tight">
            <p className="font-semibold text-slate-900">Sigmaflux Auto Reply</p>
            <p className="text-xs text-muted">Sign in to manage keyword triggers</p>
          </div>
        </div>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorText error={mutation.error} />
        <Button type="submit" className="w-full" loading={mutation.isPending}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
