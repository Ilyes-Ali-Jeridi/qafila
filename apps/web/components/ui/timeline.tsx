import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TimelineItem {
  key: string;
  title: ReactNode;
  body?: ReactNode;
  when?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'saffron';
  action?: ReactNode;
}

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  const dot = { default: 'bg-indigo-300', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', saffron: 'bg-saffron' };
  return (
    <ol className={cn('relative space-y-0', className)}>
      {items.map((it, i) => (
        <li key={it.key} className="relative flex gap-4 pb-5 last:pb-0">
          {i < items.length - 1 ? <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-line" /> : null}
          <span aria-hidden className={cn('relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-surface', dot[it.tone ?? 'default'])} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium">{it.title}</p>
              {it.when ? <p className="tabular text-xs text-ink-faint">{it.when}</p> : null}
            </div>
            {it.body ? <div className="mt-0.5 text-sm text-ink-muted">{it.body}</div> : null}
            {it.action ? <div className="mt-1">{it.action}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
