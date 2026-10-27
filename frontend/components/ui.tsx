'use client';

import { Loader2, X } from 'lucide-react';
import { useEffect } from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
};

export function Button({ variant = 'primary', loading, className = '', children, disabled, ...props }: ButtonProps) {
  const styles = {
    primary: 'bg-ink text-white hover:bg-ink-hover border border-ink',
    secondary: 'bg-white text-slate-800 border border-line hover:bg-slate-50',
    danger: 'bg-red-600 text-white border border-red-600 hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100 border border-transparent',
  }[variant];
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ className = '', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 ${className}`}
    />
  );
}

export function Textarea({ className = '', ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 ${className}`}
    />
  );
}

export function Select({ className = '', ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 ${className}`}
    />
  );
}

export function Field({
  label,
  required,
  hint,
  counter,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  counter?: [number, number];
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {(hint || counter) && (
        <span className="mt-1 flex justify-between gap-2 text-xs text-muted">
          <span>{hint}</span>
          {counter && (
            <span className={counter[0] > counter[1] ? 'text-red-600' : ''}>
              {counter[0]}/{counter[1]}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-emerald-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 border-b border-line bg-slate-50/60 px-6 py-4">
          {icon && (
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-600 ring-1 ring-line">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Card({ step, title, subtitle, children, className = '' }: {
  step?: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-white ${className}`}>
      <header className="flex items-center gap-3 rounded-t-2xl border-b border-line bg-slate-50/60 px-5 py-4">
        {step !== undefined && (
          <span className="flex size-7 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
            {step}
          </span>
        )}
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="size-6 animate-spin text-slate-400" />
    </div>
  );
}
