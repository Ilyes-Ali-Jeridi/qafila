import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({ title, eyebrow, lead, action, className }: { title: ReactNode; eyebrow?: ReactNode; lead?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        {lead ? <p className="mt-2 max-w-2xl text-sm text-ink-muted sm:text-base">{lead}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
