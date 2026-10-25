import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Stat tile: eyebrow label, oversized display number, hint. */
export function Stat({ label, value, hint, className, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string; tone?: 'default' | 'success' | 'warning' | 'danger' | 'teal' | 'saffron' }) {
  const valueTone = { default: '', success: 'text-success', warning: 'text-warning', danger: 'text-danger', teal: 'text-teal', saffron: 'text-saffron' }[tone ?? 'default'];
  return (
    <div className={cn('glass hairline-top rounded-card p-4', className)}>
      <p className="eyebrow">{label}</p>
      <div className={cn('tabular mt-1.5 font-display text-2xl font-bold leading-none tracking-tight', valueTone)}>{value}</div>
      {hint ? <p className="mt-1.5 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
