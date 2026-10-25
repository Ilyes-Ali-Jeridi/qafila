'use client';
import type { DealDetail } from '@qafila/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Timeline } from '@/components/ui/timeline';
import { TxLink } from '@/components/ui/tx-link';
import { EmptyState } from '@/components/ui/states';
import { formatDateTime } from '@/lib/utils';
import { formatAmount } from '@qafila/shared';
import { useToken } from '@/lib/config';

const TITLES: Record<string, string> = {
  promised: 'Purchase promise signed, security deposit locked',
  promise_withdrawn: 'Promise withdrawn, deposit returned',
  deal_listed: 'Deal listed',
  invested: 'Investment',
  funded: 'Fully funded',
  deposit_paid: 'Supplier deposit paid',
  bl_uploaded: 'Bill of lading uploaded',
  shipment_confirmed: 'Shipment confirmed by the agent, balance paid',
  murabaha_accepted: 'Sale signed at the fixed price',
  security_applied: 'Security deposit counted as first payment',
  repaid: 'Repayment',
  late_fee_to_charity: 'Late fee paid, set aside for charity',
  swept: 'Swept to charity',
  claimed: 'Investor claimed',
  closed: 'Deal closed',
  cancelled: 'Cancelled',
  refund_owed: 'Refund owed to the importer',
  refunded: 'Refund paid',
  aborted: 'Stopped by ops',
  defaulted: 'Marked in default',
  recovery: 'Recovery deposited',
  security_used: 'Security deposit used for the loss',
  liquidated: 'Wound up',
  due_extended: 'Due date extended once, price unchanged',
  bl_released: 'Bill of lading released to the importer',
};

const TONES: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'saffron'> = {
  funded: 'success',
  shipment_confirmed: 'success',
  repaid: 'success',
  claimed: 'success',
  late_fee_to_charity: 'saffron',
  swept: 'saffron',
  aborted: 'danger',
  defaulted: 'danger',
  cancelled: 'warning',
  liquidated: 'warning',
  security_used: 'warning',
};

export function OnchainTimeline({ timeline, title = 'On-chain timeline' }: { timeline: DealDetail['timeline']; title?: string }) {
  const token = useToken();
  const items = [...timeline]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e, i) => {
      const amt = e.data['amount'] ?? e.data['security'] ?? e.data['sale_price'];
      return {
        key: `${e.txHash}-${e.type}-${i}`,
        title: TITLES[e.type] ?? e.type.replaceAll('_', ' '),
        body: typeof amt === 'string' && /^\d+$/.test(amt) ? formatAmount(amt, token.code) : undefined,
        when: formatDateTime(e.at),
        tone: TONES[e.type] ?? 'default',
        action: <TxLink hash={e.txHash} short />,
      };
    });
  return (
    <Card>
      <CardHeader eyebrow={`${items.length} events`} title={title} />
      <CardBody>{items.length ? <Timeline items={items} /> : <EmptyState title="Nothing on-chain yet" body="The first event appears when the importer signs the purchase promise." />}</CardBody>
    </Card>
  );
}
