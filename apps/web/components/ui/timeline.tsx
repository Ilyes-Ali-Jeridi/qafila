import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TimelineItem {
  key: string;
  title: ReactNode;
  body?: ReactNode;
  when?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'saffron' | 'teal';
  action?: ReactNode;
}

/** Vertical ledger timeline with glowing nodes. */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  const dot = {
    default: 'bg-indigo-300 shadow-[0_0_10px_rgba(142,155,255,0.7)]',
    teal: 'bg-teal shadow-[0_0_12px_rgba(45,226,195,0.8)]',
    success: 'bg-success shadow-[0_0_12px_rgba(61,220,151,0.8)]',
    warning: 'bg-warning shadow-[0_0_12px_rgba(249,199,79,0.8)]',
    danger: 'bg-danger shadow-[0_0_12px_rgba(255,92,92,0.8)]',
    saffron: 'bg-saffron shadow-[0_0_12px_rgba(242,178,62,0.8)]',
  };
  return (
    <ol className={cn('relative space-y-0', className)}>
      {items.map((it, i) => (
        <li key={it.key} className="relative flex gap-4 pb-5 last:pb-0">
          {i < items.length - 1 ? <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-gradient-to-b from-white/20 to-white/5" /> : null}
          <span aria-hidden className={cn('relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-page', dot[it.tone ?? 'default'])} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium">{it.title}</p>
              {it.when ? <p className="tabular font-mono text-[11px] text-ink-faint">{it.when}</p> : null}
            </div>
            {it.body ? <div className="mt-0.5 font-mono text-sm text-ink-muted">{it.body}</div> : null}
            {it.action ? <div className="mt-1">{it.action}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
