'use client';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  count?: number;
}

/** Controlled tabs with proper roles. Scrolls horizontally on phones. */
export function Tabs<K extends string>({ items, value, onChange, className }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0', className)}>
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              '-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm transition-colors',
              active ? 'border-indigo font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
            {typeof t.count === 'number' ? <span className="tabular rounded-full bg-sand-200 px-1.5 text-xs text-ink-muted">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
