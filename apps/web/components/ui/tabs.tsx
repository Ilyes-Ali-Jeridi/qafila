'use client';
import { motion, useReducedMotion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  count?: number;
}

/** Controlled tabs with proper roles and a sliding teal indicator. Scrolls horizontally on phones. */
export function Tabs<K extends string>({ items, value, onChange, className }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; className?: string }) {
  const id = useId();
  const reduce = useReducedMotion();
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
              'relative -mb-px flex h-10 shrink-0 items-center gap-2 px-3 text-sm transition-colors duration-200',
              active ? 'font-medium text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
            {typeof t.count === 'number' ? <span className={cn('tabular rounded-full px-1.5 font-mono text-[11px]', active ? 'bg-teal-100 text-teal' : 'bg-white/[0.06] text-ink-muted')}>{t.count}</span> : null}
            {active ? (
              <motion.span
                layoutId={`${id}-tab-indicator`}
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-teal shadow-[0_0_12px_rgba(45,226,195,0.8)]"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
