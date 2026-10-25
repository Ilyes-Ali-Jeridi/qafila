'use client';
import { ArrowRight, Ship } from 'lucide-react';
import Link from 'next/link';
import { bpsToPercent, type DealSummary } from '@qafila/shared';
import { Card } from '@/components/ui/card';
import { humanDuration, percentOf } from '@/lib/utils';
import { DecisionBadge, StateBadge } from './badges';
import { FundingProgress } from './funding-progress';

/** Marketplace card (FLOWS V-2): goods, route, return, tenor, risk, importer history, importer deposit. */
export function DealCard({ deal, href, index = 0 }: { deal: DealSummary; href?: string; index?: number }) {
  const cost = BigInt(deal.cost);
  const markupBps = cost > 0n ? Number((BigInt(deal.markup) * 10000n) / cost) : 0;
  const netBps = cost > 0n ? Number(((BigInt(deal.markup) - BigInt(deal.platformFee)) * 10000n) / cost) : 0;
  const securityBps = cost > 0n ? Number((BigInt(deal.security) * 10000n) / cost) : 0;
  const h = deal.importerHistory;
  const history = h ? (h.on_time + h.late + h.defaulted === 0 ? 'First deal' : `${h.on_time} on time${h.late ? `, ${h.late} late` : ''}${h.defaulted ? `, ${h.defaulted} default` : ''}`) : 'No history yet';
  return (
    <Link href={href ?? `/invest/${deal.id}`} className={`block rise rise-${Math.min(4, index % 5)} focus-visible:outline-none`} data-testid={`deal-card-${deal.number}`}>
      <Card className="h-full transition-colors hover:border-indigo-300">
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Deal {deal.number}</p>
              <h3 className="mt-1 text-base font-semibold leading-snug">{deal.goodsSummary}</h3>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
                <Ship className="size-3.5 shrink-0" aria-hidden />
                {deal.route.originPort} <ArrowRight className="size-3 shrink-0" aria-hidden /> {deal.route.destinationPort}
              </p>
            </div>
            <StateBadge state={deal.state} fallback={deal.status} />
          </div>
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
            <div>
              <dt className="eyebrow">Return</dt>
              <dd className="tabular font-semibold">{bpsToPercent(netBps)}</dd>
              <dd className="text-xs text-ink-muted">{bpsToPercent(markupBps)} markup, fee out</dd>
            </div>
            <div>
              <dt className="eyebrow">Tenor</dt>
              <dd className="tabular font-semibold">{humanDuration(deal.tenorSecs)}</dd>
              <dd className="text-xs text-ink-muted">after the sale</dd>
            </div>
            <div>
              <dt className="eyebrow">Importer deposit</dt>
              <dd className="tabular font-semibold">{bpsToPercent(securityBps)}</dd>
              <dd className="text-xs text-ink-muted">locked first</dd>
            </div>
          </dl>
          <FundingProgress funded={deal.funded} cost={deal.cost} compact />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
            <DecisionBadge decision={deal.decision} riskScore={deal.riskScore} />
            <span>{history}</span>
          </div>
          {percentOf(deal.funded, deal.cost) < 100 && deal.state === 'Listed' ? null : null}
        </div>
      </Card>
    </Link>
  );
}
