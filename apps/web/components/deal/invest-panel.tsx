'use client';
/**
 * Invest flow (PLAN 9.2, FLOWS V-4): amount capped at what is left, expected profit, plain
 * risk statement, the loss order in three lines, "shares cannot be sold", one passkey
 * confirmation calling `invest`, success with the transaction link. Progress updates within
 * 10 seconds through query invalidation plus the deal's refetch interval.
 */
import { Check, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { expectedProfit, formatAmount, parseAmount, type DealDetail } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Button, buttonClasses } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Countdown } from '@/components/ui/countdown';
import { Field, Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { describeError } from '@/lib/api/client';
import { useMe, usePortfolio, useRefreshDeal } from '@/lib/api/hooks';
import { useToken } from '@/lib/config';
import { calls } from '@/lib/stellar/calls';
import { useWallet } from '@/lib/wallet/provider';
import { humanDuration, nowSecs } from '@/lib/utils';
import { FundingProgress } from './funding-progress';

export function InvestPanel({ deal }: { deal: DealDetail }) {
  const w = useWallet();
  const me = useMe();
  const portfolio = usePortfolio();
  const token = useToken();
  const refresh = useRefreshDeal();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: string; amount: bigint } | null>(null);

  const cost = BigInt(deal.cost);
  const left = cost - BigInt(deal.funded);
  const open = deal.state === 'Listed' && left > 0n && (!deal.fundingDeadline || nowSecs() <= deal.fundingDeadline);

  const parsed = useMemo(() => {
    if (!raw.trim()) return { amount: null as bigint | null, error: null as string | null };
    try {
      const a = parseAmount(raw);
      if (a <= 0n) return { amount: null, error: 'Enter an amount above zero.' };
      if (a > left) return { amount: null, error: `Only ${formatAmount(left, token.code)} is left to fund.` };
      return { amount: a, error: null };
    } catch {
      return { amount: null, error: 'Enter a number like 25 or 25.50.' };
    }
  }, [raw, left, token.code]);

  const profit = parsed.amount ? expectedProfit(parsed.amount, BigInt(deal.markup), BigInt(deal.platformFee), cost) : 0n;
  const invested = portfolio.data ? BigInt(portfolio.data.totals.invested) : null;
  const concentration = parsed.amount && invested !== null && invested + parsed.amount > 0n ? Number(((parsed.amount + BigInt(portfolio.data?.positions.find((p) => p.dealId === deal.id)?.shares ?? '0')) * 100n) / (invested + parsed.amount)) : 0;

  async function confirm() {
    if (!parsed.amount || !w.address || deal.onchainId === null) return;
    setError(null);
    try {
      const r = await w.invoke(calls.invest(w.address, deal.onchainId, parsed.amount));
      setDone({ hash: r.hash, amount: parsed.amount });
      setRaw('');
      refresh(deal.id);
      setTimeout(() => refresh(deal.id), 6_000);
    } catch (e) {
      setError(describeError(e));
    }
  }

  const header = <CardHeader eyebrow={open ? 'Open for funding' : 'Funding'} title={open ? 'Invest in this shipment' : 'Funding status'} />;

  if (!open) {
    return (
      <Card data-testid="invest-panel">
        {header}
        <CardBody className="space-y-3">
          <FundingProgress funded={deal.funded} cost={deal.cost} />
          <p className="text-sm text-ink-muted">{deal.state === 'Listed' ? 'The funding deadline has passed. If the cost is not reached, everyone gets 100% back.' : left <= 0n ? 'This deal is fully funded.' : 'This deal is no longer open for funding.'}</p>
        </CardBody>
      </Card>
    );
  }

  if (w.status !== 'connected') {
    return (
      <Card data-testid="invest-panel">
        {header}
        <CardBody className="space-y-4">
          <FundingProgress funded={deal.funded} cost={deal.cost} />
          {deal.fundingDeadline ? (
            <p className="text-sm text-ink-muted">
              Closes in <Countdown until={deal.fundingDeadline} />.
            </p>
          ) : null}
          <p className="text-sm">Create a passkey wallet in about 20 seconds to fund this deal. No seed phrase, no XLM.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/onboarding?role=investor&next=/invest/${deal.id}`} className={buttonClasses('primary')} data-testid="invest-create-wallet">
              Create my wallet
            </Link>
            <Link href={`/onboarding?mode=signin&next=/invest/${deal.id}`} className={buttonClasses('outline')}>
              Sign in
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (me.data && !me.data.investorApproved) {
    return (
      <Card data-testid="invest-panel">
        {header}
        <CardBody className="space-y-4">
          <FundingProgress funded={deal.funded} cost={deal.cost} />
          <Callout tone="indigo" title="One step left">
            <p>Finish sign-up so your wallet is approved to hold shares. It takes a few seconds.</p>
          </Callout>
          <Link href={`/onboarding?role=investor&next=/invest/${deal.id}`} className={buttonClasses('primary')}>
            Finish sign-up
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card data-testid="invest-panel">
      {header}
      <CardBody className="space-y-4">
        <FundingProgress funded={deal.funded} cost={deal.cost} />
        {deal.fundingDeadline ? (
          <p className="text-sm text-ink-muted">
            Closes in <Countdown until={deal.fundingDeadline} />.
          </p>
        ) : null}

        {done ? (
          <Callout tone="success" title={`You now own a share of ${deal.goodsSummary}`}>
            <p>
              <Amount value={done.amount} /> invested. Your shares and the progress bar update within 10 seconds. <TxLink hash={done.hash} />
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setDone(null)}>
              Invest more
            </Button>
          </Callout>
        ) : (
          <>
            <Field label={`Amount in ${token.label || 'test dollars'}`} htmlFor="invest-amount" error={parsed.error ?? undefined} hint={`Up to ${formatAmount(left, token.code)} left to fund.`}>
              <Input id="invest-amount" inputMode="decimal" placeholder="25" value={raw} onChange={(e) => setRaw(e.target.value)} aria-invalid={Boolean(parsed.error)} data-testid="invest-amount" />
            </Field>
            <div className="flex flex-wrap gap-2">
              {[10n, 50n, 100n].map((n) => {
                const v = n * 10_000_000n;
                if (v > left) return null;
                return (
                  <Button key={String(n)} variant="outline" size="sm" onClick={() => setRaw(String(n))}>
                    {String(n)}
                  </Button>
                );
              })}
              <Button variant="outline" size="sm" onClick={() => setRaw(formatAmount(left, '').trim().replaceAll(',', ''))}>
                All that is left
              </Button>
            </div>

            <div className="rounded-md border border-line bg-surface-2 p-3 text-sm" data-testid="invest-summary">
              <div className="flex justify-between">
                <span className="text-ink-muted">Expected profit</span>
                <Amount value={profit} sign className="font-semibold text-success" />
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">You get back on repayment</span>
                <Amount value={(parsed.amount ?? 0n) + profit} className="font-semibold" />
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">When</span>
                <span className="tabular">about {humanDuration(deal.tenorSecs)} after the sale is signed</span>
              </div>
            </div>

            <Callout tone="warning" title="You can lose money">
              <p>If the importer does not repay and nothing is recovered, losses are shared by all holders. Who loses first:</p>
              <ol className="list-decimal pl-5">
                {deal.lossOrder.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ol>
              <p>Your shares cannot be sold before the deal ends.</p>
            </Callout>
            {concentration > 25 && invested !== null && invested > 0n ? (
              <Callout tone="warning" title="More than a quarter of your portfolio">
                <p>This deal would be {concentration}% of everything you have invested. Spreading across deals lowers the risk of one default.</p>
              </Callout>
            ) : null}

            {error ? <InlineError>{error}</InlineError> : null}
            {!w.contractReady ? <InlineError>The Qafila contract is not deployed on this network yet. Investing opens when it is.</InlineError> : null}
            <Button size="lg" className="w-full" onClick={confirm} loading={w.busy} disabled={!parsed.amount || !w.contractReady || deal.onchainId === null} icon={w.kind === 'passkey' ? <KeyRound className="size-4" /> : <Check className="size-4" />} data-testid="invest-confirm">
              {w.kind === 'passkey' ? 'Confirm with my passkey' : 'Confirm in my wallet'}
            </Button>
            <p className="text-center text-xs text-ink-muted">Fees are paid for you. Nothing moves until you confirm.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
