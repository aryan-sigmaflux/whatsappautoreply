'use client';

import { useMutation } from '@tanstack/react-query';
import { CircleSlash, FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { endpoints, MATCH_LABEL, RESPONSE_LABEL, type TryResult } from '@/lib/api';
import ResponsePreview from './ResponsePreview';
import { Button, ErrorText, Field, Input, Modal, Select, Textarea } from './ui';

type MessageType = 'text' | 'button' | 'media';

export default function TryMessageModal({
  open,
  onClose,
  workspaceId,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
}) {
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [message, setMessage] = useState('');
  const [source, setSource] = useState('');
  const [result, setResult] = useState<TryResult | null>(null);

  const test = useMutation({
    mutationFn: () =>
      endpoints.tryMessage(workspaceId, { message, message_type: messageType, source: source.trim() || undefined }),
    onSuccess: setResult,
  });

  const close = () => {
    setResult(null);
    test.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Try a message"
      subtitle="See which trigger would answer. Nothing is sent."
      icon={<FlaskConical className="size-4" />}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
          <Button
            onClick={() => test.mutate()}
            loading={test.isPending}
            disabled={messageType !== 'media' && !message.trim()}
          >
            Test
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          test.mutate();
        }}
      >
        <Field label="Message type">
          <Select
            value={messageType}
            onChange={(e) => {
              setMessageType(e.target.value as MessageType);
              setResult(null);
            }}
          >
            <option value="text">Typed message</option>
            <option value="button">Button / list tap</option>
            <option value="media">Photo, video or file (no text)</option>
          </Select>
        </Field>
        {messageType !== 'media' && (
          <Field label={messageType === 'button' ? 'Button title' : 'Message'}>
            <Textarea
              rows={3}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setResult(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (message.trim()) test.mutate();
                }
              }}
              placeholder={messageType === 'button' ? 'e.g. Book a demo' : 'e.g. price list'}
            />
          </Field>
        )}
        <Field label="Source (optional)" hint="Where the chat came from, e.g. facebook or instagram for ad clicks.">
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Any source" />
        </Field>
      </form>

      <div className="mt-5">
        <ErrorText error={test.error} />
        {result &&
          (result.trigger ? (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-900">{result.trigger.name}</span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  {MATCH_LABEL[result.trigger.match_type]}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {RESPONSE_LABEL[result.trigger.response_type]}
                </span>
                {!result.trigger.is_active && <span className="text-xs text-amber-700">inactive</span>}
                <Link
                  href={`/auto-reply/${result.trigger.id}`}
                  className="ml-auto text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
                >
                  Edit trigger
                </Link>
              </div>
              <p className="text-sm text-emerald-800">{result.reason}</p>
              <ResponsePreview type={result.trigger.response_type} response={result.trigger.response} />
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-line bg-slate-50 p-4 text-sm text-slate-600">
              <CircleSlash className="mt-0.5 size-4 shrink-0 text-slate-400" />
              {result.reason}
            </div>
          ))}
      </div>
    </Modal>
  );
}
