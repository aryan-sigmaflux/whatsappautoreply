'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, CircleAlert, Copy, KeyRound, Plus, RefreshCw, Send, Trash2, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';
import AppShell, { useWorkspaces } from '@/components/AppShell';
import { Button, Card, ErrorText, Field, Input, Modal, Spinner, Textarea, Toggle } from '@/components/ui';
import { endpoints, formatDateTime, type Workspace } from '@/lib/api';
import { useSession } from '@/store/session';

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
      <Button
        variant="secondary"
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function NewAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const setWorkspace = useSession((s) => s.setWorkspace);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const create = useMutation({
    mutationFn: () => endpoints.createWorkspace({ name, api_key: apiKey || null }),
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      setWorkspace(ws.id);
      setName('');
      setApiKey('');
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect a GetGabs account"
      subtitle="Each account gets its own webhook URL and keyword triggers."
      icon={<Plus className="size-4" />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim()}>
            Connect
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Account name" required hint="Shown in the account switcher, e.g. the client or brand name.">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sigmaflux" />
        </Field>
        <Field label="GetGabs API key" hint="GetGabs dashboard → API key. You can add it later.">
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Production API key" />
        </Field>
        <ErrorText error={create.error} />
      </div>
    </Modal>
  );
}

function AccountSettings({ ws }: { ws: Workspace }) {
  const qc = useQueryClient();
  const setWorkspace = useSession((s) => s.setWorkspace);
  const [name, setName] = useState(ws.name);
  const [apiKey, setApiKey] = useState('');
  const [isActive, setIsActive] = useState(ws.is_active);
  const [testTo, setTestTo] = useState('');
  const [testText, setTestText] = useState('Hello! This is a test message from Sigmaflux Auto Reply.');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['workspaces'] });

  const save = useMutation({
    mutationFn: () => endpoints.updateWorkspace(ws.id, { name, is_active: isActive, api_key: apiKey.trim() || null }),
    onSuccess: () => {
      setApiKey('');
      refresh();
    },
  });
  const rotate = useMutation({
    mutationFn: () => endpoints.rotateWebhook(ws.id),
    onSuccess: () => {
      setConfirmRotate(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => endpoints.deleteWorkspace(ws.id),
    onSuccess: () => {
      setWorkspace(null);
      setConfirmDelete(false);
      refresh();
    },
  });
  const test = useMutation({ mutationFn: () => endpoints.testSend(ws.id, testTo, testText) });

  const dirty = name !== ws.name || isActive !== ws.is_active || apiKey.trim() !== '';

  return (
    <div className="space-y-6">
      <Card title="Account" subtitle="Name, GetGabs API key and whether auto replies are on.">
        <div className="space-y-4">
          <Field label="Account name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label="GetGabs API key"
            hint={
              ws.has_api_key
                ? `Saved: ${ws.api_key_masked}. Leave empty to keep it.`
                : 'Required to send replies. Find it in your GetGabs dashboard.'
            }
          >
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={ws.has_api_key ? '••••••••••••' : 'Paste production API key'}
            />
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Auto replies {isActive ? 'on' : 'paused'}</p>
              <p className="text-xs text-muted">When paused, incoming messages are received but nothing is sent.</p>
            </div>
            <Toggle checked={isActive} onChange={setIsActive} label="Auto replies on" />
          </div>
          <ErrorText error={save.error} />
          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !name.trim()}>
              Save changes
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Webhook" subtitle="Where GetGabs sends this account's incoming WhatsApp messages.">
        <div className="space-y-4">
          <Field label="Webhook URL">
            <CopyField value={ws.webhook_url} />
          </Field>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>In GetGabs, open the webhook settings for this WhatsApp number.</li>
            <li>Paste the URL above as the webhook for incoming messages and save.</li>
            <li>
              Turn off GetGabs&apos; own Keyword Triggers for the same keywords, otherwise customers get two replies.
            </li>
            <li>Send a WhatsApp message to your number. The status below turns green when it arrives.</li>
          </ol>
          <div
            className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${
              ws.last_webhook_at ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
            }`}
          >
            {ws.last_webhook_at ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
            {ws.last_webhook_at
              ? `Connected. Last message received ${formatDateTime(ws.last_webhook_at)}.`
              : 'No messages received yet.'}
            <button onClick={refresh} className="ml-auto rounded p-1 hover:bg-black/5" title="Refresh status">
              <RefreshCw className="size-3.5" />
            </button>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setConfirmRotate(true)}>
              <RefreshCw className="size-4" /> Generate new URL
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Test sending" subtitle="Check the API key works by sending a plain text message.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            test.mutate();
          }}
        >
          <Field
            label="WhatsApp number"
            hint="With country code, e.g. 919876543210. The number must have messaged you in the last 24 hours."
          >
            <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="919876543210" required />
          </Field>
          <Field label="Message">
            <Textarea rows={2} value={testText} onChange={(e) => setTestText(e.target.value)} required />
          </Field>
          <ErrorText error={test.error} />
          {test.isSuccess && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Sent. Check WhatsApp.</p>
          )}
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" loading={test.isPending} disabled={!ws.has_api_key}>
              <Send className="size-4" /> Send test
            </Button>
          </div>
        </form>
      </Card>

      <div className="flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50/40 px-5 py-4">
        <div>
          <p className="font-medium text-slate-900">Remove this account</p>
          <p className="text-sm text-muted">Deletes its webhook and all its keyword triggers.</p>
        </div>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-4" /> Remove
        </Button>
      </div>

      <Modal
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        title="Generate a new webhook URL?"
        subtitle="The current URL stops working right away. You'll need to paste the new one into GetGabs."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRotate(false)}>
              Cancel
            </Button>
            <Button onClick={() => rotate.mutate()} loading={rotate.isPending}>
              Generate
            </Button>
          </>
        }
      >
        <ErrorText error={rotate.error} />
      </Modal>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Remove ${ws.name}?`}
        subtitle="This deletes the account, its webhook and every keyword trigger in it. It can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
              Remove account
            </Button>
          </>
        }
      >
        <ErrorText error={remove.error} />
      </Modal>
    </div>
  );
}

function SetupPage() {
  const { list, current, isLoading, error } = useWorkspaces();
  const setWorkspace = useSession((s) => s.setWorkspace);
  const [creating, setCreating] = useState(false);

  // The account switcher links here with ?new=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCreating(true);
      window.history.replaceState(null, '', '/setup');
    }
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Setup</h1>
          <p className="mt-1 text-sm text-muted">
            Connect GetGabs WhatsApp accounts. Each one has its own webhook URL and triggers.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Connect account
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorText error={error} />
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white px-6 py-16 text-center">
          <Webhook className="mx-auto size-8 text-slate-400" />
          <p className="mt-3 font-medium text-slate-800">No accounts connected yet</p>
          <p className="mt-1 text-sm text-muted">Connect a GetGabs account to get its webhook URL.</p>
          <Button className="mt-5" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Connect account
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <div className="space-y-1.5">
            {list.map((w) => (
              <button
                key={w.id}
                onClick={() => setWorkspace(w.id)}
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                  current?.id === w.id
                    ? 'border-slate-300 bg-white font-medium shadow-sm'
                    : 'border-transparent text-slate-600 hover:bg-white'
                }`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    !w.is_active ? 'bg-slate-300' : w.has_api_key && w.last_webhook_at ? 'bg-emerald-500' : 'bg-amber-400'
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {!w.has_api_key && <KeyRound className="size-3.5 text-amber-500" aria-label="API key missing" />}
              </button>
            ))}
          </div>
          {current && <AccountSettings key={current.id + current.webhook_url} ws={current} />}
        </div>
      )}
      <NewAccountModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export default function Page() {
  return (
    <AppShell>
      <SetupPage />
    </AppShell>
  );
}
