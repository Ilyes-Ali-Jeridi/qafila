'use client';
/** Landing live feed: the latest indexed on-chain events with stellar.expert links, refreshed every 8 s. */
import Link from 'next/link';
import { useEvents } from '@/lib/api/hooks';
import { describeError } from '@/lib/api/client';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { timeAgo } from '@/lib/utils';

export function LiveFeed({ limit = 8 }: { limit?: number }) {
  const q = useEvents(limit);
  if (q.isPending) {
    return (
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-16" />
          </li>
        ))}
      </ul>
    );
  }
  if (q.isError) return <ErrorState compact title="The live feed is not available" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) return <p className="rounded-card border border-dashed border-line-strong p-4 text-sm text-ink-muted">No on-chain events yet. The first one appears when an importer signs a purchase promise.</p>;
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-surface" data-testid="live-feed" aria-live="polite">
      {q.data.map((e) => (
        <li key={`${e.txHash}-${e.type}`} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="leading-snug">
              {e.dealId ? (
                <Link href={`/deals/${e.dealId}`} className="font-medium text-indigo hover:underline">
                  Deal {e.dealNumber}
                </Link>
              ) : null}{' '}
              <span>{e.summary}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-ink-muted">
            <span className="tabular">{timeAgo(e.at)}</span>
            <TxLink hash={e.txHash} short />
          </div>
        </li>
      ))}
    </ul>
  );
}
