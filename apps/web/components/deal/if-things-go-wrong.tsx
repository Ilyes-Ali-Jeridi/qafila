'use client';
import { ShieldAlert } from 'lucide-react';
import { bpsToPercent, type DealDetail } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { usePublicConfig } from '@/lib/config';

/** FLOWS V-5: the importer's deposit, the loss order, the worst case, Qafila's stake, the fee rule. Every number from this deal. */
export function IfThingsGoWrong({ deal }: { deal: DealDetail }) {
  const { data: config } = usePublicConfig();
  const cost = BigInt(deal.cost);
  const securityBps = cost > 0n ? Number((BigInt(deal.security) * 10000n) / cost) : 0;
  const coinvest = config?.coinvestBps ?? 500;
  return (
    <Card data-testid="if-things-go-wrong">
      <CardHeader eyebrow="Before you decide" title="If things go wrong" action={<ShieldAlert className="size-5 text-warning" aria-hidden />} />
      <CardBody className="space-y-4 text-sm">
        <div className="rounded-md bg-sand-100 p-3">
          <p className="eyebrow">The importer put money in first</p>
          <p className="mt-1">
            <Amount value={deal.security} className="font-semibold" /> <span className="text-ink-muted">({bpsToPercent(securityBps)} of the cost), locked when they signed the promise.</span>
          </p>
        </div>
        <div>
          <p className="eyebrow">Who loses first</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {deal.lossOrder.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
        </div>
        <div>
          <p className="eyebrow">Worst case</p>
          <p className="mt-1">
            {deal.worstCase.note} <span className="tabular font-semibold">{bpsToPercent(deal.worstCase.investorRecoveryBps)}</span> of what you put in comes back.
          </p>
        </div>
        <ul className="space-y-1 text-ink-muted">
          <li>Qafila invests {bpsToPercent(coinvest)} of this deal and loses alongside you.</li>
          <li>The platform fee is earned only when the deal is repaid.</li>
          <li>Shares cannot be sold before the end of the deal.</li>
          <li>Late fees go to charity, never to investors.</li>
        </ul>
      </CardBody>
    </Card>
  );
}
