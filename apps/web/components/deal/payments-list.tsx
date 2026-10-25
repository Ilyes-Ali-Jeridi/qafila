'use client';
import type { DealDetail } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { TxLink } from '@/components/ui/tx-link';
import { EmptyState } from '@/components/ui/states';
import { formatDateTime } from '@/lib/utils';

const LABEL: Record<DealDetail['payments'][number]['kind'], string> = {
  supplier_deposit: 'Supplier deposit',
  supplier_balance: 'Supplier balance',
  security_locked: 'Importer security deposit locked',
  security_applied: 'Security deposit counted as first payment',
  security_refunded: 'Security deposit refunded',
  repayment: 'Repayment by the importer',
  late_fee: 'Late fee to charity',
  claim: 'Investor claim',
  recovery: 'Recovery',
  sweep: 'Sweep to charity',
};

/** FLOWS S-3: the supplier sees both payments with transaction links; everyone sees every money movement. */
export function PaymentsList({ payments, filter }: { payments: DealDetail['payments']; filter?: (p: DealDetail['payments'][number]) => boolean }) {
  const rows = [...payments].filter(filter ?? (() => true)).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card>
      <CardHeader eyebrow="Money movements" title="Payments" />
      <CardBody>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((p, i) => (
              <li key={`${p.txHash}-${i}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{LABEL[p.kind]}</p>
                  <p className="text-xs text-ink-muted">{formatDateTime(p.at)}</p>
                </div>
                <div className="text-right">
                  <Amount value={p.amount} className="font-medium" />
                  <div>{p.txHash ? <TxLink hash={p.txHash} short /> : <span className="text-xs text-ink-faint">pending</span>}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No payments yet" body="The first payment is the importer's security deposit." />
        )}
      </CardBody>
    </Card>
  );
}
