'use client';
/** FLOWS I-8: sign the murabaha sale at the fixed price. Already paid (deposit), left to pay, due date, late-fee rule, accept-window countdown, one passkey confirmation. */
import { KeyRound, PenLine } from 'lucide-react';
import { useState } from 'react';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Countdown } from '@/components/ui/countdown';
import { KV } from '@/components/ui/kv';
import { InlineError } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { describeError } from '@/lib/api/client';
import { useRefreshDeal } from '@/lib/api/hooks';
import type { ImporterDealDetail } from '@/lib/api/schemas';
import { calls } from '@/lib/stellar/calls';
import { useWallet } from '@/lib/wallet/provider';
import { humanDuration, nowSecs } from '@/lib/utils';

export function SignSale({ deal }: { deal: ImporterDealDetail }) {
  const w = useWallet();
  const refresh = useRefreshDeal();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const oc = deal.onchain;
  if (!oc) return null;
  const cost = BigInt(oc.terms.cost);
  const price = cost + BigInt(oc.terms.markup);
  const paid = BigInt(oc.security);
  const left = price - paid;
  const windowEnd = oc.owned_at + oc.terms.accept_window_secs;
  const closed = nowSecs() > windowEnd;

  async function sign() {
    if (deal.onchainId === null) return;
    setError(null);
    try {
      const r = await w.invoke(calls.acceptMurabaha(deal.onchainId));
      setDone(r.hash);
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <Card data-testid="sign-sale">
      <CardHeader eyebrow="Step 10" title={done ? 'Sale signed' : 'Qafila owns the goods. Sign the sale.'} action={<PenLine className="size-5 text-indigo" aria-hidden />} />
      <CardBody className="space-y-4">
        <KV
          rows={[
            { k: 'Fixed price', v: <Amount value={price} className="font-semibold" />, hint: 'cost plus the markup agreed at listing; never changes' },
            { k: 'Already paid', v: <Amount value={paid} />, hint: 'your security deposit counts as the first payment' },
            { k: 'Left to pay', v: <Amount value={left} className="font-semibold" /> },
            { k: 'Due', v: `${humanDuration(oc.terms.tenor_secs)} after you sign, in one or more payments` },
            { k: 'If the last payment is late', v: <span><Amount value={oc.terms.late_fee} /> to charity</span> },
          ]}
        />
        {done ? (
          <Callout tone="success" title="Done">
            <p>
              The sale is on-chain and the due date is set. Ops releases the bill of lading to you. <TxLink hash={done} />
            </p>
          </Callout>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              {closed ? (
                <span className="text-danger">The window to sign has passed. Ops will contact you.</span>
              ) : (
                <>
                  Window to sign: <Countdown until={windowEnd} /> left. After that the goods may be sold elsewhere and only the actual loss is taken from your deposit.
                </>
              )}
            </p>
            {error ? <InlineError>{error}</InlineError> : null}
            {!closed ? (
              <Button size="lg" onClick={sign} loading={w.busy} disabled={!w.contractReady} icon={<KeyRound className="size-4" />} data-testid="sign-sale-confirm">
                Sign the sale at <Amount value={price} className="font-semibold" />
              </Button>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
