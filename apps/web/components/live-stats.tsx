'use client';
import { formatAmount } from '@qafila/shared';
import { useStats } from '@/lib/api/hooks';
import { describeError } from '@/lib/api/client';
import { useToken } from '@/lib/config';
import { ErrorState, Skeleton } from '@/components/ui/states';

/** Live stats from GET /stats, refreshed every 10 seconds (PLAN 9.2 landing). Every number comes from the API. */
export function LiveStats() {
  const q = useStats();
  const token = useToken();
  if (q.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (q.isError) return <ErrorState compact title="Live stats are not available" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const open = s.dealsByState['Listed'] ?? 0;
  const items: [string, string, string?][] = [
    ['Wallets created', s.walletsCreated.toLocaleString('en-US'), `${s.joinedDuringEvent} joined at the venue`],
    ['Approved investors', s.approvedInvestors.toLocaleString('en-US')],
    ['Open deals', String(open), `${Object.values(s.dealsByState).reduce((a, b) => a + b, 0)} listed in total`],
    ['Funded', formatAmount(s.funded, token.code), token.label || undefined],
    ['Importer deposits locked', formatAmount(s.securityLocked, token.code)],
    ['Sent to charity', formatAmount(s.charityTotal, token.code), 'late fees and rounding dust'],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="live-stats">
      {items.map(([label, value, hint]) => (
        <div key={label} className="rounded-card border border-line bg-surface p-4">
          <p className="eyebrow">{label}</p>
          <p className="tabular mt-1 text-xl font-semibold leading-tight">{value}</p>
          {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
