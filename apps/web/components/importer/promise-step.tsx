'use client';
/**
 * FLOWS I-5: the purchase promise with the security deposit. Amount and percentage, two lines on
 * why, the three outcomes, the supplier guarantee, the full promise text, one passkey confirmation
 * calling promise_purchase with the security transfer. Text and hash come from POST /deals/:id/promise.
 */
import { useQuery } from '@tanstack/react-query';
import { KeyRound, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { PromiseResponse, bpsToPercent } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/input';
import { ErrorState, InlineError, SkeletonCard } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { apiPost, describeError } from '@/lib/api/client';
import { useRefreshDeal } from '@/lib/api/hooks';
import { OkSchema, type ImporterDealDetail } from '@/lib/api/schemas';
import { calls } from '@/lib/stellar/calls';
import { useWallet } from '@/lib/wallet/provider';

export function PromiseStep({ deal }: { deal: ImporterDealDetail }) {
  const w = useWallet();
  const refresh = useRefreshDeal();
  const q = useQuery({ queryKey: ['promise', deal.id], queryFn: () => apiPost(`/deals/${deal.id}/promise`, {}, PromiseResponse), enabled: w.status === 'connected' });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);

  if (q.isPending) return <SkeletonCard lines={8} />;
  if (q.isError) return <ErrorState title="Could not prepare the promise" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const cost = BigInt(p.cost);
  const security = BigInt(p.security);

  async function sign() {
    if (!w.address) return;
    setError(null);
    try {
      const r = await w.invoke(calls.promisePurchase(w.address, p.listingFingerprint, p.textHash, security));
      setDone(r.hash);
      await apiPost(`/deals/${deal.id}/promise/submitted`, { txHash: r.hash }, OkSchema).catch(() => undefined);
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (done) {
    return (
      <Card data-testid="promise-done">
        <CardHeader eyebrow="Step 5" title="Promise signed, deposit locked" />
        <CardBody className="space-y-3 text-sm">
          <p>
            <Amount value={security} className="font-semibold" /> is locked in the contract under your promise. Ops can now list the deal. <TxLink hash={done} />
          </p>
          <p className="text-ink-muted">Until the deal is listed you can withdraw the promise and get the deposit back at once.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card data-testid="promise-step">
      <CardHeader eyebrow="Step 5" title="Sign your purchase promise" action={<ScrollText className="size-5 text-indigo" aria-hidden />} />
      <CardBody className="space-y-5">
        <div className="rounded-card bg-indigo p-5 text-white">
          <p className="text-xs uppercase tracking-wide text-white/70">Security deposit to lock now</p>
          <p className="tabular mt-1 text-3xl font-semibold">
            <Amount value={security} />
          </p>
          <p className="mt-1 text-sm text-white/80">
            {bpsToPercent(p.securityBps)} of the cost of <Amount value={cost} />. It drops 2.5 points for every deal you repay on time, never below 10%.
          </p>
        </div>

        <div className="text-sm">
          <p className="eyebrow">Why there is a deposit</p>
          <p className="mt-1">Investors pay the supplier before you pay anything. Your deposit shows them you mean it, and it is what goes first if you or your supplier let them down.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <Outcome title="Deal does not happen, not your fault" body="You get it back in full, at once." tone="success" />
          <Outcome title="You break the promise" body="Only the actual loss is taken: cost minus resale, never lost profit. The rest comes back." tone="warning" />
          <Outcome title="You buy the goods" body="It counts as your first payment of the price." tone="indigo" />
        </div>

        <Callout tone="neutral" title="You vouch for your supplier">
          <p>If {deal.supplier.nameEn} takes the deposit and never ships, your security deposit covers the actual loss. You never carry loss or damage to the goods at sea or in storage; the owners carry that.</p>
        </Callout>

        <div>
          <button type="button" onClick={() => setShowText((s) => !s)} className="text-sm text-indigo underline-offset-2 hover:underline">
            {showText ? 'Hide the full promise' : 'Read the full promise'}
          </button>
          {showText ? <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-3 font-sans text-xs leading-relaxed">{p.text}</pre> : null}
          <p className="mt-1 text-xs text-ink-muted">
            Template {p.templateVersion}. Hash <code className="font-mono">{p.textHash.slice(0, 16)}…</code> is what you sign on-chain.
          </p>
        </div>

        <Checkbox id="promise-agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} label="I have read the promise. I will buy the goods at the fixed price once Qafila owns them, and I lock the security deposit now." data-testid="promise-agree" />
        {error ? <InlineError>{error}</InlineError> : null}
        {!w.contractReady ? <InlineError>The Qafila contract is not deployed on this network yet.</InlineError> : null}
        <Button size="lg" className="w-full sm:w-auto" disabled={!agree || !w.contractReady} loading={w.busy} onClick={sign} icon={<KeyRound className="size-4" />} data-testid="promise-sign">
          Sign and lock <Amount value={security} className="font-semibold" />
        </Button>
      </CardBody>
    </Card>
  );
}

function Outcome({ title, body, tone }: { title: string; body: string; tone: 'success' | 'warning' | 'indigo' }) {
  const cls = { success: 'border-success/30 bg-success-100', warning: 'border-warning/30 bg-warning-100', indigo: 'border-indigo-100 bg-indigo-50' }[tone];
  return (
    <div className={`rounded-card border p-3 ${cls}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-ink-muted">{body}</p>
    </div>
  );
}
