'use client';
import Link from 'next/link';
import { bpsToPercent, type DealSummary } from '@qafila/shared';
import SpotlightCard from '@/components/bits/SpotlightCard';
import { humanDuration } from '@/lib/utils';
import { DecisionBadge, StateBadge } from './badges';
import { FundingProgress } from './funding-progress';
import { RouteLine } from './route-line';

/** Marketplace card (FLOWS V-2): the return first, then goods, route, tenor, risk, importer history and deposit. */
export function DealCard({ deal, href, index = 0 }: { deal: DealSummary; href?: string; index?: number }) {
  const cost = BigInt(deal.cost);
  const markupBps = cost > 0n ? Number((BigInt(deal.markup) * 10000n) / cost) : 0;
  const netBps = cost > 0n ? Number(((BigInt(deal.markup) - BigInt(deal.platformFee)) * 10000n) / cost) : 0;
  const securityBps = cost > 0n ? Number((BigInt(deal.security) * 10000n) / cost) : 0;
  const h = deal.importerHistory;
  const history = h ? (h.on_time + h.late + h.defaulted === 0 ? 'First deal' : `${h.on_time} on time${h.late ? `, ${h.late} late` : ''}${h.defaulted ? `, ${h.defaulted} default` : ''}`) : 'No history yet';
  const open = deal.state === 'Listed';
  return (
    <Link href={href ?? `/invest/${deal.id}`} className={`group block h-full rounded-card rise rise-${Math.min(4, index % 5)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal`} data-testid={`deal-card-${deal.number}`}>
      <SpotlightCard spotlightColor={open ? 'rgba(242,178,62,0.2)' : 'rgba(142,155,255,0.16)'} className="glass hairline-top h-full rounded-card p-5 transition-[transform,border-color,box-shadow] duration-300 ease-[var(--ease-out-expo)] group-hover:-translate-y-0.5 group-hover:border-white/20 group-hover:shadow-pop motion-reduce:group-hover:translate-y-0">
        <div className="flex items-start justify-between gap-3">
          <p className="eyebrow">Deal {deal.number}</p>
          <StateBadge state={deal.state} fallback={deal.status} />
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className={`tabular font-display text-4xl font-bold leading-none tracking-tight ${open ? 'text-saffron' : 'text-ink'}`}>{bpsToPercent(netBps)}</p>
            <p className="mt-1.5 text-xs text-ink-muted">fixed profit, {bpsToPercent(markupBps)} markup with the fee out</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tabular font-mono text-sm font-semibold">{humanDuration(deal.tenorSecs)}</p>
            <p className="text-[11px] text-ink-muted">after the sale</p>
          </div>
        </div>
        <h3 className="mt-4 min-w-0 font-display text-base font-semibold leading-snug">{deal.goodsSummary}</h3>
        <RouteLine compact origin={deal.route.originPort} destination={deal.route.destinationPort} className="mt-2 text-xs text-ink-muted" />
        <div className="mt-4">
          <FundingProgress funded={deal.funded} cost={deal.cost} compact />
        </div>
        <dl className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs">
          <div>
            <dt className="eyebrow">Importer deposit</dt>
            <dd className="tabular mt-0.5 font-mono font-semibold text-ink">{bpsToPercent(securityBps)} <span className="font-sans font-normal text-ink-muted">locked first</span></dd>
          </div>
          <div className="text-right">
            <dt className="eyebrow">History</dt>
            <dd className="mt-0.5 text-ink-muted">{history}</dd>
          </div>
        </dl>
        <div className="mt-3">
          <DecisionBadge decision={deal.decision} riskScore={deal.riskScore} />
        </div>
      </SpotlightCard>
    </Link>
  );
}
