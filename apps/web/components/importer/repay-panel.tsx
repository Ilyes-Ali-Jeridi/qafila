'use client';
/** FLOWS I-9, I-10, I-11: repay in instalments (capped), late-fee card to charity, one extension request. */
import { CalendarClock, HandHeart, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatAmount, parseAmount } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { KV } from '@/components/ui/kv';
import { InlineError, InlineNotice } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { apiPost, describeError } from '@/lib/api/client';
import { useRefreshDeal } from '@/lib/api/hooks';
import { OkSchema, type ImporterDealDetail } from '@/lib/api/schemas';
import { useFlag, useToken } from '@/lib/config';
import { calls } from '@/lib/stellar/calls';
import { useWallet } from '@/lib/wallet/provider';
import { formatDateTime, nowSecs } from '@/lib/utils';

export function RepayPanel({ deal }: { deal: ImporterDealDetail }) {
  const w = useWallet();
  const token = useToken();
  const refresh = useRefreshDeal();
  const extensions = useFlag('FF_EXTENSIONS');
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ hash: string; amount: bigint } | null>(null);
  const oc = deal.onchain;
  const price = oc ? BigInt(oc.sale_price) : 0n;
  const repaid = oc ? BigInt(oc.principal_repaid) : 0n;
  const left = price - repaid;
  const late = oc ? nowSecs() > oc.due_at : false;

  const parsed = useMemo(() => {
    if (!raw.trim()) return { amount: null as bigint | null, error: null as string | null };
    try {
      const a = parseAmount(raw);
      if (a <= 0n) return { amount: null, error: 'Enter an amount above zero.' };
      if (a > left) return { amount: null, error: `Only ${formatAmount(left, token.code)} is left to pay.` };
      return { amount: a, error: null };
    } catch {
      return { amount: null, error: 'Enter a number like 500 or 500.50.' };
    }
  }, [raw, left, token.code]);

  async function pay() {
    if (!parsed.amount || deal.onchainId === null) return;
    setError(null);
    try {
      const r = await w.invoke(calls.repay(deal.onchainId, parsed.amount));
      setLast({ hash: r.hash, amount: parsed.amount });
      setRaw('');
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (!oc) return null;
  return (
    <Card data-testid="repay-panel" className="glass-strong border-saffron/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_60px_-24px_rgba(242,178,62,0.35)]">
      <CardHeader eyebrow="Step 12" title="Repay the fixed price" />
      <CardBody className="space-y-4">
        <KV
          rows={[
            { k: 'Fixed price', v: <Amount value={price} /> },
            { k: 'Paid so far', v: <Amount value={repaid} />, hint: 'your deposit counted first' },
            { k: 'Left to pay', v: <Amount value={left} className="font-semibold" /> },
            { k: 'Due', v: <span className={late ? 'text-danger' : ''}>{formatDateTime(oc.due_at)}{oc.extended ? ' (extended once)' : ''}</span> },
          ]}
        />
        {late ? (
          <Callout tone="warning" title="Past the due date">
            <p>
              You can still pay. When the last payment lands late, a fixed late fee of <Amount value={oc.terms.late_fee} /> is due and goes to charity, never to investors.
            </p>
          </Callout>
        ) : (
          <InlineNotice>Pay early if you like: the price stays the same and investors are paid sooner.</InlineNotice>
        )}
        {last ? (
          <InlineNotice tone="success">
            <Amount value={last.amount} /> paid. <TxLink hash={last.hash} />
          </InlineNotice>
        ) : null}
        <Field label={`Amount in ${token.label || 'test dollars'}`} htmlFor="repay-amount" error={parsed.error ?? undefined} hint="Partial payments are fine; the input never goes above what is left.">
          <Input id="repay-amount" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={formatAmount(left, '').trim()} aria-invalid={Boolean(parsed.error)} data-testid="repay-amount" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setRaw(formatAmount(left, '').trim().replaceAll(',', ''))}>
            Pay everything left
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRaw(formatAmount(left / 2n, '').trim().replaceAll(',', ''))}>
            Half
          </Button>
        </div>
        {error ? <InlineError>{error}</InlineError> : null}
        <Button size="lg" onClick={pay} loading={w.busy} disabled={!parsed.amount || !w.contractReady} icon={<KeyRound className="size-4" />} data-testid="repay-confirm">
          Pay <Amount value={parsed.amount ?? 0n} className="font-semibold" />
        </Button>
        {extensions && !oc.extended ? <ExtensionRequest deal={deal} /> : null}
      </CardBody>
    </Card>
  );
}

export function LateFeeCard({ deal }: { deal: ImporterDealDetail }) {
  const w = useWallet();
  const refresh = useRefreshDeal();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const oc = deal.onchain;
  if (!oc) return null;
  const due = BigInt(oc.late_fee_due) - BigInt(oc.late_fee_paid);
  if (due <= 0n && !done) return null;
  async function pay() {
    if (deal.onchainId === null) return;
    setError(null);
    try {
      const r = await w.invoke(calls.payLateFee(deal.onchainId, due));
      setDone(r.hash);
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    }
  }
  return (
    <Card data-testid="late-fee-card" className="glass-strong border-saffron/25">
      <CardHeader eyebrow="Late payment" title={done ? 'Late fee paid to charity' : 'Pay the late fee to charity'} action={<HandHeart className="size-5 text-saffron" aria-hidden />} />
      <CardBody className="space-y-3">
        {done ? (
          <p className="text-sm">
            Thank you. The agent sweeps it to the charity address; it shows on the{' '}
            <Link href="/charity" className="text-indigo underline-offset-2 hover:underline">
              charity ledger
            </Link>
            . <TxLink hash={done} />
          </p>
        ) : (
          <>
            <p className="text-sm">
              Your last payment landed after the due date. Investors were paid in full already. The fixed late fee of <Amount value={due} className="font-semibold" /> goes to charity, never to investors or to Qafila.
            </p>
            {error ? <InlineError>{error}</InlineError> : null}
            <Button onClick={pay} loading={w.busy} disabled={!w.contractReady} icon={<KeyRound className="size-4" />} data-testid="late-fee-pay">
              Pay <Amount value={due} className="font-semibold" /> to charity
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ExtensionRequest({ deal }: { deal: ImporterDealDetail }) {
  const refresh = useRefreshDeal();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ext = deal.extension;
  if (ext?.decision === 'pending') return <InlineNotice>Extension requested. Ops will decide; the price does not change either way.</InlineNotice>;
  if (ext?.decision === 'refused') return <InlineNotice tone="warning">Your extension request was refused. The due date stands.</InlineNotice>;
  async function send() {
    setError(null);
    setBusy(true);
    try {
      await apiPost(`/deals/${deal.id}/extension-request`, { reason }, OkSchema);
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-sm text-indigo underline-offset-2 hover:underline">
        <CalendarClock className="size-4" /> In difficulty? Ask for more time once, the price stays the same.
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-line bg-surface-2 p-3">
      <Field label="Why do you need more time?" htmlFor="ext-reason" hint="Ops grants one extension per deal, up to the limit set for this network. No fee, no higher price.">
        <Textarea id="ext-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} />
      </Field>
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={send} loading={busy} disabled={reason.trim().length < 10}>
          Send the request
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
