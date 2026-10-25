import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Stat({ label, value, hint, className, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const valueTone = { default: '', success: 'text-success', warning: 'text-warning', danger: 'text-danger' }[tone ?? 'default'];
  return (
    <div className={cn('rounded-card border border-line bg-surface p-4', className)}>
      <p className="eyebrow">{label}</p>
      <div className={cn('tabular mt-1.5 text-xl font-semibold leading-tight', valueTone)}>{value}</div>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
