'use client';
/**
 * Public deal page and investor deal detail (PLAN 9.2): goods, route map, terms, funding
 * progress, AI decision and checks, carrier events, issuer lock, on-chain timeline, the
 * "If things go wrong" box, payments. Works logged out; the invest panel appears when the
 * deal is open.
 */
import { ArrowRight, Ship } from 'lucide-react';
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
import { RouteMap } from './route-map';
import { TrackingEvents } from './tracking-events';
import { ButtonLink } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { formatDateTime } from '@/lib/utils';

export function DealScreen({ id }: { id: string }) {
  const q = useDeal(id);
  if (q.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
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
  return (
    <div className="space-y-6">
      <header className="space-y-3 rise">
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow">Deal {deal.number}</p>
          <StateBadge state={deal.state} fallback={deal.status} />
          <DecisionBadge decision={deal.decision} riskScore={deal.riskScore} />
        </div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{deal.goodsSummary}</h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
          <Ship className="size-4" aria-hidden />
          {deal.route.originPort}, {deal.route.originCountry}
          <ArrowRight className="size-3.5" aria-hidden />
          {deal.route.destinationPort}, {deal.route.destinationCountry}
          {deal.tracking?.vessel ? <span>· on {deal.tracking.vessel}</span> : null}
          {deal.onchain && deal.state === 'Owned' ? (
            <span>
              · sale to sign within <Countdown until={deal.onchain.owned_at + deal.onchain.terms.accept_window_secs} />
            </span>
          ) : null}
          {sold && deal.onchain ? <span>· due {formatDateTime(deal.onchain.due_at)}</span> : null}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="rise rise-1">
            <RouteMap route={deal.route} vessel={deal.tracking?.vessel} />
          </div>
          <div className="lg:hidden">
            <InvestPanel deal={deal} />
          </div>
          <div className="rise rise-2">
            <DealTerms deal={deal} />
          </div>
          {deal.publicReport ? (
            <div className="rise rise-3">
              <ChecksList report={deal.publicReport} />
            </div>
          ) : (
            <Card>
              <CardHeader eyebrow="AI verification" title="Not screened yet" />
              <CardBody className="text-sm text-ink-muted">The report appears once the documents have been checked.</CardBody>
            </Card>
          )}
          {deal.tracking ? <TrackingEvents tracking={deal.tracking} /> : null}
          <PaymentsList payments={deal.payments} />
          <OnchainTimeline timeline={deal.timeline} />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="hidden lg:block">
            <InvestPanel deal={deal} />
          </div>
          <IfThingsGoWrong deal={deal} />
          <EscrowCard deal={deal} />
          {deal.issuer ? (
            <Card>
              <CardHeader eyebrow="Share token" title="Who controls the shares" />
              <CardBody>
                <IssuerBadge issuer={deal.issuer} />
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
