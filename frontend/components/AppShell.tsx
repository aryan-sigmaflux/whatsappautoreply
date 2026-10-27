'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, LogOut, Menu, Settings2, Zap } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { endpoints, type Workspace } from '@/lib/api';
import { useSession } from '@/store/session';
import { Spinner } from './ui';

const NAV = [
  { href: '/setup', label: 'Setup', icon: Settings2 },
  { href: '/auto-reply', label: 'Auto Reply', icon: Zap },
];

/** The selected workspace, falling back to the first one when the stored id is stale. */
export function useWorkspaces() {
  const token = useSession((s) => s.token);
  const workspaceId = useSession((s) => s.workspaceId);
  const query = useQuery({ queryKey: ['workspaces'], queryFn: endpoints.workspaces, enabled: !!token });
  const list = query.data ?? [];
  const current = list.find((w) => w.id === workspaceId) ?? list[0] ?? null;
  return { ...query, list, current };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

function WorkspaceSwitcher({ list, current }: { list: Workspace[]; current: Workspace | null }) {
  const setWorkspace = useSession((s) => s.setWorkspace);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-slate-100"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-800">
          {current ? initials(current.name) : '?'}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{current?.name ?? 'No account yet'}</span>
        <ChevronsUpDown className="size-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-line bg-white p-1 shadow-lg">
          {list.map((w) => (
            <button
              key={w.id}
              onClick={() => {
                setWorkspace(w.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {!w.is_active && <span className="text-xs text-slate-400">paused</span>}
              {current?.id === w.id && <Check className="size-4 text-emerald-600" />}
            </button>
          ))}
          <Link
            href="/setup?new=1"
            onClick={() => setOpen(false)}
            className="mt-1 block rounded-lg border-t border-line px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            + Connect another account
          </Link>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user, logout } = useSession();
  const { list, current } = useWorkspaces();
  const [mounted, setMounted] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // The session lives in localStorage, so the first render can't know it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !token) router.replace('/login');
  }, [mounted, token, router]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNavOpen(false), [pathname]);

  if (!mounted || !token) return <Spinner />;

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-line bg-white">
      <div className="flex items-center gap-2 px-5 pt-5 pb-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-white">
          <Zap className="size-4" />
        </span>
        <div className="leading-tight">
          <p className="font-semibold text-slate-900">Sigmaflux</p>
          <p className="text-xs text-muted">Auto Reply</p>
        </div>
      </div>
      <div className="px-3">
        <WorkspaceSwitcher list={list} current={current} />
      </div>
      <nav className="mt-4 flex-1 space-y-1 px-3">
        <p className="px-2 pb-1 text-xs font-medium text-slate-400">Automation</p>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-line' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="m-3 flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
          {initials(user?.name ?? '?')}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-slate-800">{user?.name}</p>
          <p className="truncate text-xs text-muted">{user?.email}</p>
        </div>
        <button onClick={logout} title="Log out" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-dvh bg-white">
      <div className="hidden lg:block">{sidebar}</div>
      {navOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setNavOpen(false)}>
          <div className="h-full w-64" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3 lg:hidden">
          <button onClick={() => setNavOpen(true)} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="truncate font-medium">{current?.name ?? 'Sigmaflux Auto Reply'}</span>
        </div>
        <main className="flex-1 overflow-y-auto bg-canvas/40">{children}</main>
      </div>
    </div>
  );
}
