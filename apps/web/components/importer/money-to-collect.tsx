'use client';
/** FLOWS I-6: refunds owed to the importer (cancel, no-fault abort, unused deposit). One tap pulls them. */
import { HandCoins } from 'lucide-react';
import { useState } from 'react';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InlineError } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { useRefreshDeal } from '@/lib/api/hooks';
import { calls } from '@/lib/stellar/calls';
import { useWallet } from '@/lib/wallet/provider';

export function MoneyToCollect({ amount }: { amount: string }) {
  const w = useWallet();
  const toast = useToast();
  const refresh = useRefreshDeal();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (BigInt(amount) <= 0n && !done) return null;
  async function collect() {
    if (!w.address) return;
    setError(null);
    try {
      const r = await w.invoke(calls.withdrawRefund(w.address));
      setDone(r.hash);
      toast.push({ tone: 'success', title: 'Refund collected', body: <TxLink hash={r.hash} /> });
      refresh();
    } catch (e) {
      setError(describeError(e));
    }
  }
  return (
    <Card data-testid="money-to-collect">
      <CardHeader eyebrow="Money to collect" title={done ? 'Collected' : 'Your security deposit is waiting'} action={<HandCoins className="size-5 text-saffron" aria-hidden />} />
      <CardBody className="space-y-3">
        {done ? (
          <p className="text-sm text-ink-muted">
            The refund reached your wallet. <TxLink hash={done} />
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Amount value={amount} size="lg" />
              <Button onClick={collect} loading={w.busy} data-testid="collect-refund">
                Collect now
              </Button>
            </div>
            <p className="text-sm text-ink-muted">A deal did not happen through no fault of yours, so the deposit comes back in full. The agent sends it anyway if you do nothing.</p>
            {error ? <InlineError>{error}</InlineError> : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
