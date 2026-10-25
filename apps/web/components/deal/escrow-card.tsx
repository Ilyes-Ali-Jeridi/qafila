'use client';
/**
 * S2 (PLAN 10.1): the Trustless Work escrow that pays the supplier. Rendered only when the
 * deal's payment mode is TrustlessWork. Links the escrow contract (viewer and stellar.expert),
 * shows the protocol fee the deal carries and the state of both milestones.
 */
import { ExternalLink, Lock } from 'lucide-react';
import { bpsToPercent, type DealDetail } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KV } from '@/components/ui/kv';
import { ContractLink } from '@/components/ui/tx-link';

function milestoneState(m: NonNullable<DealDetail['escrow']>['milestones'][number]): { label: string; tone: string } {
  if (m.released) return { label: 'Released to the supplier', tone: 'text-success' };
  if (m.resolved) return { label: 'Resolved by the dispute resolver', tone: 'text-warning' };
  if (m.disputed) return { label: 'In dispute', tone: 'text-danger' };
  if (m.approved) return { label: 'Approved, release pending', tone: 'text-ink' };
  return { label: 'Waiting for the deal contract', tone: 'text-ink-muted' };
}

export function EscrowCard({ deal }: { deal: DealDetail }) {
  const escrow = deal.escrow;
  if (!escrow || deal.onchain?.terms.payment_mode !== 'TrustlessWork') return null;
  const depositBps = deal.onchain.terms.deposit_bps;
  return (
    <Card data-testid="escrow-card">
      <CardHeader eyebrow="Supplier payment" title="Trustless Work escrow" action={<Lock className="size-5 text-ink-muted" aria-hidden />} />
      <CardBody className="space-y-4 text-sm">
        <p className="text-ink-muted">
          The deal contract pays the supplier into this escrow. The agent releases each part after its check: {bpsToPercent(depositBps)} at order, the rest once the bill of lading is verified.
          {escrow.mode === 'mock' ? ' Mock escrow.' : null}
        </p>
        <KV
          rows={[
            { k: 'Escrow contract', v: <ContractLink id={escrow.id} /> },
            {
              k: 'Escrow viewer',
              v: escrow.url ? (
                <a href={escrow.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo underline-offset-2 hover:underline">
                  Open <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : (
                'none'
              ),
            },
            { k: 'Invoice cost', v: <Amount value={escrow.invoiceCost} /> },
            { k: 'Escrow fee carried by the deal', v: <span><Amount value={escrow.fee} /> <span className="text-ink-muted">({bpsToPercent(escrow.feeBps)} of each payout)</span></span>, hint: 'Included in the cost above, so the supplier nets the invoice.' },
          ]}
        />
        {escrow.milestones.length ? (
          <ol className="space-y-2">
            {escrow.milestones.map((m) => {
              const s = milestoneState(m);
              return (
                <li key={m.index} className="flex items-start justify-between gap-3 rounded-md bg-sand-100 p-3">
                  <div>
                    <p className="font-medium">{m.index === 0 ? 'Deposit' : 'Balance'}</p>
                    <p className={`text-xs ${s.tone}`}>{s.label}</p>
                  </div>
                  <Amount value={m.amount} className="font-medium" />
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-ink-muted">Milestone state is read from the escrow when it is online.</p>
        )}
      </CardBody>
    </Card>
  );
}
