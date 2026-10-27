'use client';

import { useMutation } from '@tanstack/react-query';
import { Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { endpoints, type MediaType } from '@/lib/api';
import { Button, ErrorText, Input } from './ui';

// WhatsApp's own limits for media sent by URL.
const RULES: Record<MediaType, { accept: string; maxMb: number; label: string }> = {
  image: { accept: 'image/jpeg,image/png', maxMb: 5, label: 'JPG or PNG, up to 5 MB' },
  video: { accept: 'video/mp4,video/3gpp', maxMb: 16, label: 'MP4 or 3GP, up to 16 MB' },
  audio: { accept: 'audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg', maxMb: 16, label: 'MP3, AAC, M4A, AMR or OGG, up to 16 MB' },
  document: { accept: '*', maxMb: 100, label: 'PDF, DOCX, XLSX… up to 100 MB' },
};

export default function MediaPicker({
  workspaceId,
  kind,
  url,
  filename,
  onChange,
}: {
  workspaceId: string;
  kind: MediaType;
  url?: string;
  filename?: string;
  onChange: (v: { url: string; filename?: string }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const rule = RULES[kind];

  const upload = useMutation({
    mutationFn: (file: File) => endpoints.upload(workspaceId, file),
    onSuccess: (res) => onChange({ url: res.url, filename: res.filename }),
  });

  const pick = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (file.size > rule.maxMb * 1024 * 1024) {
      setLocalError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. WhatsApp allows up to ${rule.maxMb} MB for ${kind}.`);
      return;
    }
    upload.mutate(file);
  };

  return (
    <div className="space-y-2">
      {url ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-slate-700" title={url}>
            {filename || url}
          </span>
          <button
            type="button"
            onClick={() => onChange({ url: '', filename: '' })}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            aria-label="Remove file"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>
            <Upload className="size-4" /> Upload {kind}
          </Button>
          <Input
            placeholder="…or paste a public https:// link"
            onBlur={(e) => e.target.value.trim() && onChange({ url: e.target.value.trim() })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const v = e.currentTarget.value.trim();
                if (v) onChange({ url: v });
              }
            }}
          />
        </div>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={rule.accept === '*' ? undefined : rule.accept}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <p className="text-xs text-muted">{rule.label}</p>
      <ErrorText error={localError ?? upload.error} />
    </div>
  );
}
