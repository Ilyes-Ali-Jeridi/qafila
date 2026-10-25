'use client';
/**
 * FLOWS I-5: the purchase promise with the security deposit. Amount and percentage, two lines on
 * why, the three outcomes, the supplier guarantee, the full promise text, one passkey confirmation
 * calling promise_purchase with the security transfer. Text and hash come from POST /deals/:id/promise.
 * Reads like a signed document: a hairline frame, a seal, the hash as the signature line.
 */
import { useQuery } from '@tanstack/react-query';
import { KeyRound, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { PromiseResponse, bpsToPercent } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { HashReveal } from '@/components/ui/hash-reveal';
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
      <Card data-testid="promise-done" className="border-success/30">
        <CardHeader eyebrow="Step 5" title="Promise signed, deposit locked" />
        <CardBody className="space-y-3 text-sm">
          <p>
            <Amount value={security} className="font-semibold" /> is locked in the contract under your promise. Ops can now list the deal.
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <HashReveal hash={done} />
            <TxLink hash={done} className="text-xs" />
          </p>
          <p className="text-ink-muted">Until the deal is listed you can withdraw the promise and get the deposit back at once.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card data-testid="promise-step" className="glass-strong">
      <CardHeader eyebrow="Step 5" title="Sign your purchase promise" action={<ScrollText className="size-5 text-saffron" aria-hidden />} />
      <CardBody className="space-y-5">
        <div className="relative overflow-hidden rounded-[calc(var(--radius-card)-4px)] border border-saffron/30 bg-saffron-100 p-5">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[radial-gradient(closest-side,rgba(242,178,62,0.35),transparent)] blur-xl" />
          <p className="eyebrow text-saffron-700">Security deposit to lock now</p>
          <p className="mt-2">
            <Amount value={security} size="2xl" className="text-saffron" />
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {bpsToPercent(p.securityBps)} of the cost of <Amount value={cost} className="text-ink" />. It drops 2.5 points for every deal you repay on time, never below 10%.
          </p>
        </div>

        <div className="text-sm">
          <p className="eyebrow">Why there is a deposit</p>
          <p className="mt-1">Investors pay the supplier before you pay anything. Your deposit shows them you mean it, and it is what goes first if you or your supplier let them down.</p>
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <Outcome n="1" title="Deal does not happen, not your fault" body="You get it back in full, at once." tone="success" />
          <Outcome n="2" title="You break the promise" body="Only the actual loss is taken: cost minus resale, never lost profit. The rest comes back." tone="warning" />
          <Outcome n="3" title="You buy the goods" body="It counts as your first payment of the price." tone="teal" />
        </div>

        <Callout tone="neutral" title="You vouch for your supplier">
          <p>If {deal.supplier.nameEn} takes the deposit and never ships, your security deposit covers the actual loss. You never carry loss or damage to the goods at sea or in storage; the owners carry that.</p>
        </Callout>

        <div className="rounded-[calc(var(--radius-card)-4px)] border border-line-strong p-4 [background:repeating-linear-gradient(0deg,transparent_0_27px,rgba(255,255,255,0.03)_27px_28px)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold">Purchase promise</p>
            <button type="button" onClick={() => setShowText((s) => !s)} aria-expanded={showText} className="text-sm text-indigo underline-offset-2 hover:underline">
              {showText ? 'Hide the full promise' : 'Read the full promise'}
            </button>
          </div>
          {showText ? <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-page/60 p-3 font-sans text-xs leading-relaxed">{p.text}</pre> : null}
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-dashed border-line-strong pt-3">
            <p className="text-xs text-ink-muted">
              Template {p.templateVersion}. The hash below is what you sign on-chain.
            </p>
            <p className="font-mono text-xs text-teal" title={p.textHash}>
              {p.textHash.slice(0, 16)}…
            </p>
          </div>
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

function Outcome({ n, title, body, tone }: { n: string; title: string; body: string; tone: 'success' | 'warning' | 'teal' }) {
  const cls = { success: 'border-success/30 bg-success-100 [&_.n]:text-success', warning: 'border-warning/30 bg-warning-100 [&_.n]:text-warning', teal: 'border-teal/30 bg-teal-100 [&_.n]:text-teal' }[tone];
  return (
    <div className={`rounded-[calc(var(--radius-card)-4px)] border p-3 ${cls}`}>
      <p className="n font-mono text-xs">{n}</p>
      <p className="mt-1 font-medium">{title}</p>
      <p className="mt-1 text-ink-muted">{body}</p>
    </div>
  );
}
