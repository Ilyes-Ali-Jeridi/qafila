import type { ReactNode } from 'react';

/** Loading, empty and error states for every screen (PLAN 9.2). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-sand-200 ${className}`} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-sand-200 bg-surface p-8 text-center">
      <p className="text-base font-medium">{title}</p>
      {body ? <p className="mt-1 text-sm text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-card border border-danger/30 bg-surface p-6">
      <p className="font-medium text-danger">{title}</p>
      {body ? <p className="mt-1 text-sm text-ink-muted">{body}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 rounded-md bg-indigo px-3 py-1.5 text-sm text-white hover:bg-indigo-700">
          Try again
        </button>
      ) : null}
    </div>
  );
}
