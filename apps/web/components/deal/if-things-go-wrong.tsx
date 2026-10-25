'use client';
import { ShieldAlert } from 'lucide-react';
import { bpsToPercent, type DealDetail } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { usePublicConfig } from '@/lib/config';
import { LossRail } from './loss-rail';

/** FLOWS V-5: the importer's deposit, the loss order, the worst case, Qafila's stake, the fee rule. Every number from this deal. */
export function IfThingsGoWrong({ deal }: { deal: DealDetail }) {
  const { data: config } = usePublicConfig();
  const cost = BigInt(deal.cost);
  const securityBps = cost > 0n ? Number((BigInt(deal.security) * 10000n) / cost) : 0;
  const coinvest = config?.coinvestBps ?? 500;
  return (
    <Card data-testid="if-things-go-wrong" className="border-warning/20">
      <CardHeader eyebrow="Before you decide" title="If things go wrong" action={<ShieldAlert className="size-5 text-warning" aria-hidden />} />
      <CardBody className="space-y-5 text-sm">
        <div className="rounded-[calc(var(--radius-card)-4px)] border border-saffron/25 bg-saffron-100 p-3">
          <p className="eyebrow text-saffron-700">The importer put money in first</p>
          <p className="mt-1">
            <Amount value={deal.security} size="lg" className="text-saffron" /> <span className="text-ink-muted">({bpsToPercent(securityBps)} of the cost), locked when they signed the promise.</span>
          </p>
        </div>
        <div>
          <p className="eyebrow mb-2">Who loses first</p>
          <LossRail steps={deal.lossOrder} />
        </div>
        <div className="rounded-[calc(var(--radius-card)-4px)] border border-line bg-white/[0.03] p-3">
          <p className="eyebrow">Worst case</p>
          <p className="mt-1">
            {deal.worstCase.note} <span className="tabular font-mono text-base font-semibold text-ink">{bpsToPercent(deal.worstCase.investorRecoveryBps)}</span> of what you put in comes back.
          </p>
        </div>
        <ul className="space-y-1.5 text-ink-muted">
          <li className="flex gap-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-teal" />Qafila invests {bpsToPercent(coinvest)} of this deal and loses alongside you.</li>
          <li className="flex gap-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-teal" />The platform fee is earned only when the deal is repaid.</li>
          <li className="flex gap-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-teal" />Shares cannot be sold before the end of the deal.</li>
          <li className="flex gap-2"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-teal" />Late fees go to charity, never to investors.</li>
        </ul>
      </CardBody>
    </Card>
  );
}
