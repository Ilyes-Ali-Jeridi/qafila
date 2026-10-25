'use client';
/** Portfolio (PLAN 9.2, FLOWS V-6): positions by state, expected and realised profit, Claim, refunds, history. */
import { HandCoins, KeyRound, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { RequireWallet } from '@/components/require-wallet';
import { StateBadge } from '@/components/deal/badges';
import { Amount } from '@/components/ui/amount';
import { Button, ButtonLink } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Stat } from '@/components/ui/stat';
import { EmptyState, ErrorState, InlineError, SkeletonList } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { TxLink } from '@/components/ui/tx-link';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { usePortfolio, useRefreshDeal } from '@/lib/api/hooks';
import type { PortfolioPosition } from '@/lib/api/schemas';
import { calls } from '@/lib/stellar/calls';
import { useWallet } from '@/lib/wallet/provider';
import { formatDate, formatDateTime, humanDuration } from '@/lib/utils';

type Tab = 'active' | 'claimable' | 'history';

export function PortfolioScreen() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Investor" title="Portfolio" lead="Your shares in each shipment, what they should earn and what is ready to claim." />
      <RequireWallet title="Connect to see your portfolio">
        <Inner />
      </RequireWallet>
    </div>
  );
}

function group(p: PortfolioPosition): Tab {
  if (p.claimable && !p.claimed) return 'claimable';
  if (p.claimed || p.state === 'Closed') return 'history';
  return 'active';
}

function Inner() {
  const q = usePortfolio();
  const w = useWallet();
  const toast = useToast();
  const refresh = useRefreshDeal();
  const [tab, setTab] = useState<Tab>('active');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (q.isPending) return <SkeletonList count={3} />;
  if (q.isError) return <ErrorState title="Could not load your portfolio" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  const pf = q.data;
  const by = (t: Tab) => pf.positions.filter((p) => group(p) === t);
  const shown = by(tab);
  const refund = BigInt(pf.refundOwed);

  async function claim(p: PortfolioPosition) {
    if (!w.address || p.onchainId === null) return;
    setError(null);
    setBusyId(p.dealId);
    try {
      const r = await w.invoke(calls.claim(w.address, p.onchainId));
      toast.push({ tone: 'success', title: `Claimed from deal ${p.number}`, body: <TxLink hash={r.hash} /> });
      refresh(p.dealId);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusyId(null);
    }
  }
  async function withdrawRefund() {
    if (!w.address) return;
    setError(null);
    setBusyId('refund');
    try {
      const r = await w.invoke(calls.withdrawRefund(w.address));
      toast.push({ tone: 'success', title: 'Refund collected', body: <TxLink hash={r.hash} /> });
      refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invested" value={<Amount value={pf.totals.invested} />} hint="in open deals" />
        <Stat label="Expected profit" value={<Amount value={pf.totals.expectedProfit} sign />} hint="if every importer repays" tone="success" />
        <Stat label="Realised profit" value={<Amount value={pf.totals.realisedProfit} sign />} hint="from finished deals" />
        <Stat label="Ready to claim" value={<Amount value={pf.totals.claimable} />} hint={BigInt(pf.totals.claimable) > 0n ? 'tap Claim below' : 'nothing waiting'} tone={BigInt(pf.totals.claimable) > 0n ? 'success' : 'default'} />
      </div>

      {refund > 0n ? (
        <Card>
          <CardHeader eyebrow="Money to collect" title="A refund is waiting for this wallet" action={<HandCoins className="size-5 text-saffron" />} />
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <Amount value={refund} size="lg" />
            <Button onClick={withdrawRefund} loading={busyId === 'refund'} icon={<Wallet className="size-4" />}>
              Collect
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {error ? <InlineError>{error}</InlineError> : null}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'active', label: 'Active', count: by('active').length },
          { key: 'claimable', label: 'Ready to claim', count: by('claimable').length },
          { key: 'history', label: 'History', count: by('history').length },
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState
          title={tab === 'active' ? 'No active positions' : tab === 'claimable' ? 'Nothing to claim right now' : 'No finished deals yet'}
          body={tab === 'active' ? 'Fund a shipment to see it here. Shares arrive within 10 seconds of your confirmation.' : tab === 'claimable' ? 'When a deal is repaid, cancelled or wound up, your share appears here. The agent claims for you after 24 hours anyway.' : 'Claimed positions and closed deals end up here.'}
          action={tab === 'active' ? <ButtonLink href="/invest">See open deals</ButtonLink> : undefined}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="positions">
          {shown.map((p) => (
            <li key={p.dealId}>
              <Card className="h-full">
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow">Deal {p.number}</p>
                      <Link href={`/invest/${p.dealId}`} className="mt-0.5 block font-semibold leading-snug hover:underline">
                        {p.goodsSummary}
                      </Link>
                      <p className="text-xs text-ink-muted">{p.route}</p>
                    </div>
                    <StateBadge state={p.state} />
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="eyebrow">Shares</dt>
                      <dd>
                        <Amount value={p.shares} className="font-medium" />
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow">{p.claimed ? 'Realised' : 'Expected'}</dt>
                      <dd>
                        <Amount value={p.claimed ? (p.realisedProfit ?? '0') : p.expectedProfit} sign className={`font-medium ${BigInt(p.claimed ? (p.realisedProfit ?? '0') : p.expectedProfit) >= 0n ? 'text-success' : 'text-danger'}`} />
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow">{p.dueAt ? 'Due' : 'Tenor'}</dt>
                      <dd className="tabular">{p.dueAt ? formatDate(p.dueAt) : humanDuration(p.tenorSecs)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                    <span>
                      Invested {formatDateTime(p.investedAt)} {p.investTxHash ? <TxLink hash={p.investTxHash} short /> : null}
                    </span>
                    {p.claimed && p.claimTxHash ? (
                      <span>
                        Claimed <TxLink hash={p.claimTxHash} short />
                      </span>
                    ) : null}
                  </div>
                  {p.claimable && !p.claimed ? (
                    <div className="flex items-center justify-between gap-3 rounded-md bg-success-100 p-3">
                      <div className="text-sm">
                        <p className="eyebrow">Ready to claim</p>
                        <Amount value={p.claimable} className="font-semibold" />
                      </div>
                      <Button onClick={() => claim(p)} loading={busyId === p.dealId} icon={w.kind === 'passkey' ? <KeyRound className="size-4" /> : undefined} data-testid={`claim-${p.number}`}>
                        Claim
                      </Button>
                    </div>
                  ) : null}
                  {p.state === 'Defaulted' ? (
                    <Callout tone="warning">
                      <p>Recovery is running. What is recovered is shared pro rata when ops finalizes; the deal page shows each step.</p>
                    </Callout>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
