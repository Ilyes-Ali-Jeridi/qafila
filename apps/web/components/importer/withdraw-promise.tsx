'use client';
/** FLOWS I-6: "Withdraw" until listing pays the deposit back at once. */
import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InlineError } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { describeError } from '@/lib/api/client';
import { useRefreshDeal } from '@/lib/api/hooks';
import type { ImporterDealDetail } from '@/lib/api/schemas';
import { calls } from '@/lib/stellar/calls';
import { useWallet } from '@/lib/wallet/provider';

export function WithdrawPromise({ deal }: { deal: ImporterDealDetail }) {
  const w = useWallet();
  const refresh = useRefreshDeal();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const p = deal.promise;
  if (!p || !p.txHash) return null;
  async function withdraw() {
    if (!w.address || !p) return;
    if (!window.confirm('Withdraw the promise? The deposit comes back now and the deal will not be listed.')) return;
    setError(null);
    try {
      const r = await w.invoke(calls.withdrawPromise(w.address, p.listingFingerprint));
      setDone(r.hash);
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    }
  }
  return (
    <Card data-testid="withdraw-promise">
      <CardHeader eyebrow="Waiting for listing" title="Your promise is on-chain" />
      <CardBody className="space-y-3 text-sm">
        <p>
          Security deposit of <Amount value={p.security} className="font-semibold" /> locked. {p.txHash ? <TxLink hash={p.txHash} /> : null}
        </p>
        <p className="text-ink-muted">Ops issues the share token and lists the deal next. Until then you can change your mind.</p>
        {done ? (
          <p>
            Promise withdrawn, deposit returned. <TxLink hash={done} />
          </p>
        ) : (
          <>
            {error ? <InlineError>{error}</InlineError> : null}
            <Button variant="outline" size="sm" onClick={withdraw} loading={w.busy} disabled={!p.withdrawable} icon={<Undo2 className="size-4" />}>
              Withdraw and get the deposit back
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
