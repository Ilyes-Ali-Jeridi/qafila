import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-ink placeholder:text-ink-faint disabled:opacity-60 aria-[invalid=true]:border-danger';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-11 text-base sm:h-10 sm:text-sm', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24 py-2 text-base sm:text-sm', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, 'h-11 appearance-none bg-[right_0.75rem_center] bg-no-repeat pr-9 text-base sm:h-10 sm:text-sm', className)} style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235b6577' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>\")" }} {...rest}>
      {children}
    </select>
  );
}

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-sm font-medium text-ink', className)} {...rest} />;
}

export function Field({ label, htmlFor, hint, error, children, className }: { label: ReactNode; htmlFor: string; hint?: ReactNode; error?: string | undefined; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ className, label, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; id: string }) {
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-3 text-sm', className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-indigo" {...rest} />
      <span>{label}</span>
    </label>
  );
}
