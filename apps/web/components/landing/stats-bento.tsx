'use client';
/** Live stats from GET /stats as a bento grid, refreshed every 10 seconds. Every number comes from the API. */
import CountUp from '@/components/bits/CountUp';
import SpotlightCard from '@/components/bits/SpotlightCard';
import { InView } from '@/components/motion/reveal';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { describeError } from '@/lib/api/client';
import { useStats } from '@/lib/api/hooks';
import { useToken } from '@/lib/config';
import { cn } from '@/lib/utils';

const toUnits = (stroops: string) => Number(BigInt(stroops) / 100_000n) / 100;

function Tile({ label, hint, className, children, tone = 'default' }: { label: string; hint?: string; className?: string; children: React.ReactNode; tone?: 'default' | 'saffron' | 'teal' }) {
  const color = tone === 'saffron' ? 'rgba(242,178,62,0.22)' : tone === 'teal' ? 'rgba(45,226,195,0.2)' : 'rgba(142,155,255,0.18)';
  return (
    <SpotlightCard spotlightColor={color} className={cn('glass hairline-top rounded-card p-4 sm:p-5', className)}>
      <p className="eyebrow">{label}</p>
      <div className={cn('tabular mt-2 font-display font-bold leading-none tracking-tight', tone === 'saffron' ? 'text-saffron' : tone === 'teal' ? 'text-teal' : 'text-ink')}>{children}</div>
      {hint ? <p className="mt-2 text-xs text-ink-muted">{hint}</p> : null}
    </SpotlightCard>
  );
}

export function StatsBento() {
  const q = useStats();
  const token = useToken();
  if (q.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Skeleton className="h-36 sm:col-span-2 lg:row-span-2 lg:h-full" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (q.isError) return <ErrorState compact title="Live stats are not available" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const open = s.dealsByState['Listed'] ?? 0;
  const total = Object.values(s.dealsByState).reduce((a, b) => a + b, 0);
  const money = (v: string) => <CountUp to={toUnits(v)} decimals={2} separator="," duration={1.4} trigger="load" suffix={token.code ? ` ${token.code}` : ''} />;
  return (
    <InView>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="live-stats">
        <Tile label="Funded" hint={token.label || undefined} tone="saffron" className="sm:col-span-2 lg:row-span-2 lg:flex lg:flex-col lg:justify-end [&>div]:text-4xl [&>div]:sm:text-5xl [&>div]:lg:text-6xl">
          {money(s.funded)}
        </Tile>
        <Tile label="Wallets created" hint={`${s.joinedDuringEvent} joined at the venue`} className="[&>div]:text-3xl">
          <CountUp to={s.walletsCreated} separator="," duration={1.2} trigger="load" />
        </Tile>
        <Tile label="Approved investors" className="[&>div]:text-3xl">
          <CountUp to={s.approvedInvestors} separator="," duration={1.2} trigger="load" />
        </Tile>
        <Tile label="Open deals" hint={`${total} listed in total`} tone="teal" className="[&>div]:text-3xl">
          <CountUp to={open} duration={1} trigger="load" />
        </Tile>
        <Tile label="Importer deposits locked" className="[&>div]:text-2xl">
          {money(s.securityLocked)}
        </Tile>
        <Tile label="Sent to charity" hint="late fees and rounding dust" className="sm:col-span-3 lg:col-span-2 [&>div]:text-2xl">
          {money(s.charityTotal)}
        </Tile>
      </div>
    </InView>
  );
}
