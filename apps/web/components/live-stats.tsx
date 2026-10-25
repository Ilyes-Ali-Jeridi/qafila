'use client';
import { useQuery } from '@tanstack/react-query';
import { StatsSchema, formatAmount } from '@qafila/shared';
import { apiGet, ApiRequestError } from '@/lib/api/client';
import { ErrorState, Skeleton } from '@/components/ui/states';

/** Live stats from GET /stats, refreshed every 10 seconds (PLAN 9.2 landing). */
export function LiveStats() {
  const q = useQuery({ queryKey: ['stats'], queryFn: () => apiGet('/stats', StatsSchema), refetchInterval: 10_000 });

  if (q.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (q.isError) {
    const e = q.error;
    const notBuilt = e instanceof ApiRequestError && e.status === 501;
    return <ErrorState title={notBuilt ? 'Live stats are not available yet' : 'Could not load live stats'} body={notBuilt ? undefined : e.message} onRetry={() => void q.refetch()} />;
  }
  const s = q.data;
  const items: [string, string][] = [
    ['Wallets created', s.walletsCreated.toLocaleString('en-US')],
    ['Funded', formatAmount(s.funded)],
    ['Profit paid', formatAmount(s.profitPaid)],
    ['Sent to charity', formatAmount(s.charityTotal)],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-card border border-sand-200 bg-surface p-4">
          <p className="text-xs text-ink-muted">{label}</p>
          <p className="tabular mt-1 text-xl font-semibold">{value}</p>
        </div>
      ))}
    </div>
  );
}
