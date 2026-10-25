'use client';
/**
 * Public deal page and investor deal detail (PLAN 9.2): goods, route map, terms, funding
 * progress, AI decision and checks, carrier events, issuer lock, on-chain timeline, the
 * "If things go wrong" box, payments. Works logged out; the invest panel appears when the
 * deal is open.
 */
import { bpsToPercent } from '@qafila/shared';
import CountUp from '@/components/bits/CountUp';
import { Item, Stagger } from '@/components/motion/reveal';
import { useDeal } from '@/lib/api/hooks';
import { ApiRequestError, describeError } from '@/lib/api/client';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton, SkeletonCard } from '@/components/ui/states';
import { DecisionBadge, StateBadge } from './badges';
import { ChecksList } from './checks-list';
import { DealTerms } from './deal-terms';
import { EscrowCard } from './escrow-card';
import { IfThingsGoWrong } from './if-things-go-wrong';
import { InvestPanel } from './invest-panel';
import { IssuerBadge } from './issuer-badge';
import { OnchainTimeline } from './onchain-timeline';
import { PaymentsList } from './payments-list';
import { RouteLine } from './route-line';
import { RouteMap } from './route-map';
import { TrackingEvents } from './tracking-events';
import { ButtonLink } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { useToken } from '@/lib/config';
import { formatDateTime, humanDuration } from '@/lib/utils';

const toUnits = (stroops: string) => Number(BigInt(stroops) / 100_000n) / 100;

export function DealScreen({ id }: { id: string }) {
  const q = useDeal(id);
  const token = useToken();
  if (q.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <Skeleton className="h-64" />
            <SkeletonCard lines={6} />
            <SkeletonCard lines={8} />
          </div>
          <div className="space-y-4">
            <SkeletonCard lines={5} />
            <SkeletonCard lines={6} />
          </div>
        </div>
      </div>
    );
  }
  if (q.isError) {
    if (q.error instanceof ApiRequestError && q.error.status === 404) {
      return <EmptyState title="This deal is not public" body="It may still be in screening, or the link is wrong." action={<ButtonLink href="/invest" variant="outline">See open deals</ButtonLink>} />;
    }
    return <ErrorState title="Could not load this deal" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  }
  const deal = q.data;
  const sold = deal.onchain && deal.onchain.sale_price !== '0';
  const cost = BigInt(deal.cost);
  const netBps = cost > 0n ? Number(((BigInt(deal.markup) - BigInt(deal.platformFee)) * 10000n) / cost) : 0;
  const securityBps = cost > 0n ? Number((BigInt(deal.security) * 10000n) / cost) : 0;
  return (
    <Stagger className="space-y-6">
      <Item className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow">Deal {deal.number}</p>
          <StateBadge state={deal.state} fallback={deal.status} />
          <DecisionBadge decision={deal.decision} riskScore={deal.riskScore} />
        </div>
        <h1 className="max-w-3xl font-display text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl">{deal.goodsSummary}</h1>
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="min-w-0 space-y-1 text-sm text-ink-muted">
            <RouteLine origin={`${deal.route.originPort}, ${deal.route.originCountry}`} destination={`${deal.route.destinationPort}, ${deal.route.destinationCountry}`} className="max-w-md text-ink" />
            <p className="flex flex-wrap gap-x-2 gap-y-1">
              {deal.tracking?.vessel ? <span>on {deal.tracking.vessel}</span> : null}
              {deal.onchain && deal.state === 'Owned' ? (
                <span>
                  sale to sign within <Countdown until={deal.onchain.owned_at + deal.onchain.terms.accept_window_secs} />
                </span>
              ) : null}
              {sold && deal.onchain ? <span>due {formatDateTime(deal.onchain.due_at)}</span> : null}
            </p>
          </div>
          <dl className="glass hairline-top grid grid-cols-2 gap-x-6 gap-y-3 rounded-card px-5 py-4 sm:grid-cols-4 lg:min-w-[520px]">
            <div className="min-w-0">
              <dt className="eyebrow">Cost of the goods</dt>
              <dd className="tabular mt-1 whitespace-nowrap font-mono text-lg font-semibold leading-none">
                <CountUp to={toUnits(deal.cost)} decimals={2} separator="," duration={1.2} trigger="load" suffix={token.code ? ` ${token.code}` : ''} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow">Fixed profit</dt>
              <dd className="tabular mt-1 font-display text-lg font-bold leading-none text-saffron">{bpsToPercent(netBps)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow">Tenor</dt>
              <dd className="tabular mt-1 font-mono text-lg font-semibold leading-none">{humanDuration(deal.tenorSecs)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow">Importer deposit</dt>
              <dd className="tabular mt-1 font-mono text-lg font-semibold leading-none text-teal">{bpsToPercent(securityBps)}</dd>
            </div>
          </dl>
        </div>
      </Item>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Item>
            <RouteMap route={deal.route} vessel={deal.tracking?.vessel} />
          </Item>
          <div className="lg:hidden">
            <InvestPanel deal={deal} />
          </div>
          <Item>
            <DealTerms deal={deal} />
          </Item>
          <Item>
            {deal.publicReport ? (
              <ChecksList report={deal.publicReport} />
            ) : (
              <Card>
                <CardHeader eyebrow="AI verification" title="Not screened yet" />
                <CardBody className="text-sm text-ink-muted">The report appears once the documents have been checked.</CardBody>
              </Card>
            )}
          </Item>
          {deal.tracking ? (
            <Item>
              <TrackingEvents tracking={deal.tracking} />
            </Item>
          ) : null}
          <Item>
            <PaymentsList payments={deal.payments} />
          </Item>
          <Item>
            <OnchainTimeline timeline={deal.timeline} />
          </Item>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="hidden lg:block">
            <Item>
              <InvestPanel deal={deal} />
            </Item>
          </div>
          <Item>
            <IfThingsGoWrong deal={deal} />
          </Item>
          <EscrowCard deal={deal} />
          {deal.issuer ? (
            <Item>
              <Card>
                <CardHeader eyebrow="Share token" title="Who controls the shares" />
                <CardBody>
                  <IssuerBadge issuer={deal.issuer} />
                </CardBody>
              </Card>
            </Item>
          ) : null}
        </aside>
      </div>
    </Stagger>
  );
}
