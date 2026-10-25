import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Glass panel: translucent surface, hairline border, inner highlight. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('glass relative rounded-card', className)} {...rest} />;
}

export function CardHeader({ title, eyebrow, action, className }: { title: ReactNode; eyebrow?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className="mt-0.5 font-display text-base font-semibold leading-tight tracking-tight">{title}</h2>
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
export function Callout({ tone = 'neutral', title, children, className }: { tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'indigo' | 'teal'; title?: ReactNode; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'border-line bg-white/[0.04]',
    warning: 'border-warning/30 bg-warning-100',
    danger: 'border-danger/30 bg-danger-100',
    success: 'border-success/30 bg-success-100',
    indigo: 'border-indigo-300/30 bg-indigo-100',
    teal: 'border-teal/30 bg-teal-100',
  } as const;
  return (
    <div className={cn('rounded-[calc(var(--radius-card)-4px)] border p-4 text-sm', tones[tone], className)}>
      {title ? <p className="mb-1 font-medium text-ink">{title}</p> : null}
      <div className="space-y-1 text-ink-muted [&_strong]:text-ink">{children}</div>
    </div>
  );
}
