'use client';
import { bpsToPercent, type DealDetail } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KV } from '@/components/ui/kv';
import { ContractLink } from '@/components/ui/tx-link';
import { formatDateTime, humanDuration } from '@/lib/utils';

export function DealTerms({ deal }: { deal: DealDetail }) {
  const cost = BigInt(deal.cost);
  const markup = BigInt(deal.markup);
  const fee = BigInt(deal.platformFee);
  const pct = (n: bigint) => (cost > 0n ? bpsToPercent(Number((n * 10000n) / cost)) : '0%');
  const t = deal.onchain?.terms;
  return (
    <Card>
      <CardHeader eyebrow="Fixed at listing" title="Terms" />
      <CardBody>
        <KV
          rows={[
            { k: 'Cost of the goods', v: <Amount value={deal.cost} /> },
            { k: 'Fixed profit (markup)', v: <span><Amount value={deal.markup} /> <span className="text-ink-muted">({pct(markup)})</span></span> },
            { k: 'Platform fee', v: <span><Amount value={deal.platformFee} /> <span className="text-ink-muted">out of the markup, earned only on repayment</span></span> },
            { k: 'To investors on repayment', v: <span><Amount value={cost + markup - fee} /> <span className="text-ink-muted">({pct(markup - fee)} profit)</span></span> },
            { k: 'Sale price the importer owes', v: <Amount value={cost + markup} /> },
            { k: 'Importer security deposit', v: <span><Amount value={deal.security} /> <span className="text-ink-muted">({pct(BigInt(deal.security))}), counts as first payment</span></span> },
            t ? { k: 'Supplier deposit before shipment', v: `${bpsToPercent(t.deposit_bps)} of cost` } : null,
            t ? { k: 'Late fee (to charity)', v: <Amount value={t.late_fee} /> } : null,
            { k: 'Tenor', v: `${humanDuration(deal.tenorSecs)} after the sale is signed` },
            t ? { k: 'Window to sign the sale', v: `${humanDuration(t.accept_window_secs)} after the goods are owned` } : null,
            deal.fundingDeadline ? { k: 'Funding deadline', v: formatDateTime(deal.fundingDeadline) } : null,
            deal.shareToken ? { k: 'Share token', v: <ContractLink id={deal.shareToken} /> , hint: 'locked receipts, 1 per test dollar' } : null,
            deal.onchain ? { k: 'Holders', v: deal.onchain.holder_count } : null,
            t ? { k: 'Payment mode', v: t.payment_mode === 'Native' ? 'Direct from the contract' : 'Trustless Work escrow' } : null,
          ]}
        />
      </CardBody>
    </Card>
  );
}
