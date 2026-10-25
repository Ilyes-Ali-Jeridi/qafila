import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';

/** Loading, empty and error states for every screen (PLAN 9.2). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="glass rounded-card p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-2/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('mt-2 h-3', i % 2 ? 'w-5/6' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonList({ count = 3, lines }: { count?: number; lines?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="dot-field relative overflow-hidden rounded-card border border-dashed border-line-strong bg-surface/60 p-8 text-center">
      {icon ? <div className="halo halo-teal mx-auto mb-3 flex size-10 items-center justify-center rounded-full border border-teal/30 bg-teal-100 text-teal">{icon}</div> : null}
      <p className="font-display text-base font-semibold">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, body, onRetry, compact }: { title: string; body?: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={cn('glass rounded-card border-danger/30 shadow-[0_0_0_1px_rgba(255,92,92,0.08),0_12px_40px_-16px_rgba(255,92,92,0.4)]', compact ? 'p-4' : 'p-6')}>
      <p className="font-medium text-danger">{title}</p>
      {body ? <p className="mt-1 break-words text-sm text-ink-muted">{body}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-3">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="break-words rounded-md border border-danger/30 bg-danger-100 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}

export function InlineNotice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  const cls = { neutral: 'border-line bg-white/[0.04] text-ink-muted', success: 'border-success/30 bg-success-100 text-success', warning: 'border-warning/30 bg-warning-100 text-warning' }[tone];
  return <p className={cn('rounded-md border px-3 py-2 text-sm', cls)}>{children}</p>;
}
