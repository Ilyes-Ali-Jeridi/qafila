import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Key/value rows, the ledger's basic unit. */
export function KV({ rows, className, dense }: { rows: Array<{ k: ReactNode; v: ReactNode; hint?: ReactNode } | null | false>; className?: string; dense?: boolean }) {
  return (
    <dl className={cn('divide-y divide-line', className)}>
      {rows.filter(Boolean).map((r, i) => {
        const row = r as { k: ReactNode; v: ReactNode; hint?: ReactNode };
        return (
          <div key={i} className={cn('flex items-start justify-between gap-4', dense ? 'py-1.5' : 'py-2.5')}>
            <dt className="text-sm text-ink-muted">
              {row.k}
              {row.hint ? <span className="block text-xs text-ink-faint">{row.hint}</span> : null}
            </dt>
            <dd className="tabular text-right text-sm font-medium">{row.v}</dd>
          </div>
        );
      })}
    </dl>
  );
}
