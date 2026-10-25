import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-surface shadow-card', className)} {...rest} />;
}

export function CardHeader({ title, eyebrow, action, className }: { title: ReactNode; eyebrow?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className="mt-0.5 text-base font-semibold leading-tight">{title}</h2>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center gap-3 border-t border-line px-5 py-4', className)} {...rest} />;
}

/** Soft callout for notes, warnings and the "If things go wrong" box. */
export function Callout({ tone = 'neutral', title, children, className }: { tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'indigo'; title?: ReactNode; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'border-line bg-surface-2',
    warning: 'border-warning/40 bg-warning-100',
    danger: 'border-danger/40 bg-danger-100',
    success: 'border-success/40 bg-success-100',
    indigo: 'border-indigo-100 bg-indigo-50',
  } as const;
  return (
    <div className={cn('rounded-card border p-4 text-sm', tones[tone], className)}>
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="space-y-1 text-ink-muted [&_strong]:text-ink">{children}</div>
    </div>
  );
}
