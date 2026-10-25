'use client';
/** Importer dashboard (PLAN 9.2, FLOWS I-6, I-12): deals, statuses, limit, next required deposit, money to collect. */
import { Briefcase, Plus } from 'lucide-react';
import Link from 'next/link';
import { bpsToPercent } from '@qafila/shared';
import { RequireWallet } from '@/components/require-wallet';
import { MoneyToCollect } from '@/components/importer/money-to-collect';
import { StageBadge } from '@/components/importer/stage-badge';
import { Amount } from '@/components/ui/amount';
import { ButtonLink } from '@/components/ui/button';
import { Callout, Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Stat } from '@/components/ui/stat';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { describeError } from '@/lib/api/client';
import { useImporterDeals, useMe } from '@/lib/api/hooks';
import { useFlag, usePublicConfig } from '@/lib/config';
import { formatDateTime, humanDuration } from '@/lib/utils';

export function ImporterDashboard() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Importer" title="Your deals" lead="Qafila buys the goods for you, owns them until you sign, and sells them to you at a price fixed from day one." action={<ButtonLink href="/importer/new" icon={<Plus className="size-4" />}>New deal</ButtonLink>} />
      <RequireWallet title="Connect to see your deals">
        <Inner />
      </RequireWallet>
    </div>
  );
}

function Inner() {
  const me = useMe();
  const deals = useImporterDeals();
  const { data: config } = usePublicConfig();
  const passport = useFlag('FF_TRADE_PASSPORT');

  if (me.isPending || deals.isPending) return <SkeletonList count={3} lines={4} />;
  if (deals.isError) return <ErrorState title="Could not load your deals" body={describeError(deals.error)} onRetry={() => void deals.refetch()} />;
  const imp = me.data?.importer ?? null;
  const list = deals.data;
  const refund = list.find((d) => BigInt(d.refundOwed) > 0n)?.refundOwed ?? '0';
  const stats = imp?.stats;

  return (
    <div className="space-y-6">
      {!imp ? (
        <Callout tone="indigo" title="Register your company to request financing">
          <p>Company name, country, registration number and a registration document. Ops approves it before your first deal is listed.</p>
          <ButtonLink href="/onboarding?role=importer" variant="primary" size="sm" className="mt-2">
            Register my company
          </ButtonLink>
        </Callout>
      ) : imp.kybStatus === 'pending' ? (
        <Callout tone="warning" title={`${imp.legalName}: registration under review`}>
          <p>You can draft a deal and upload documents now. Listing waits for the approval; on testnet the faucet grant arrives with it.</p>
        </Callout>
      ) : imp.kybStatus === 'rejected' ? (
        <Callout tone="danger" title="Registration could not be verified">
          <p>Ops could not match the registration document to the registry. Check the number and upload it again from settings.</p>
        </Callout>
      ) : null}

      {imp ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Your limit" value={<Amount value={imp.limit} />} hint={`${bpsToPercent(0)} used`.replace('0% used', `${imp.openExposure !== '0' ? 'in use: ' : ''}`) || undefined} />
          <Stat label="Open exposure" value={<Amount value={imp.openExposure} />} hint="cost of deals not yet repaid" />
          <Stat label="Next deposit" value={bpsToPercent(imp.nextSecurityBps)} hint={config ? `falls ${bpsToPercent(config.flags.FF_COINVEST ? 250 : 250)} per on-time deal, never below 10%` : undefined} />
          <Stat label="Track record" value={stats ? `${stats.on_time} on time` : 'none yet'} hint={stats ? `${stats.late} late, ${stats.defaulted} default${stats.defaulted === 1 ? '' : 's'}` : undefined} tone={stats && stats.defaulted > 0 ? 'danger' : 'default'} />
        </div>
      ) : null}

      {imp?.faucetGrant ? (
        <Callout tone="success" title="Testnet grant received">
          <p>
            <Amount value={imp.faucetGrant.amount} /> in test dollars for your deposit and repayments. <TxLink hash={imp.faucetGrant.txHash} />
          </p>
        </Callout>
      ) : null}

      <MoneyToCollect amount={refund} />

      {list.length === 0 ? (
        <EmptyState icon={<Briefcase className="size-5" />} title="No deals yet" body="Start with your supplier's pro-forma invoice, packing list and business licence. Screening takes about a minute." action={<ButtonLink href="/importer/new">Start a deal</ButtonLink>} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="importer-deals">
          {list.map((d) => (
            <li key={d.id}>
              <Link href={`/importer/${d.id}`} className="block h-full" data-testid={`importer-deal-${d.number}`}>
                <Card className="h-full transition-colors hover:border-indigo-300">
                  <CardBody className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="eyebrow">Deal {d.number}</p>
                        <p className="mt-0.5 font-semibold leading-snug">{d.goodsSummary}</p>
                        <p className="text-xs text-ink-muted">
                          {d.route.originPort} to {d.route.destinationPort} · {d.supplier.nameEn}
                        </p>
                      </div>
                      <StageBadge stage={d.stage} />
                    </div>
                    <dl className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="eyebrow">Cost</dt>
                        <dd>{BigInt(d.terms.cost) > 0n ? <Amount value={d.terms.cost} className="font-medium" /> : 'not set'}</dd>
                      </div>
                      <div>
                        <dt className="eyebrow">Deposit</dt>
                        <dd>{BigInt(d.security) > 0n ? <Amount value={d.security} className="font-medium" /> : 'after approval'}</dd>
                      </div>
                      <div>
                        <dt className="eyebrow">Tenor</dt>
                        <dd className="tabular">{humanDuration(d.terms.tenorSecs)}</dd>
                      </div>
                    </dl>
                    <p className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-indigo">{d.nextAction}</span>
                      <span className="text-xs text-ink-faint">{formatDateTime(d.createdAt)}</span>
                    </p>
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {passport && stats && stats.on_time + stats.late + stats.defaulted > 0 ? (
        <Card>
          <CardBody className="text-sm">
            <p className="eyebrow">Trade passport</p>
            <p className="mt-1">
              {stats.on_time} on-time repayment{stats.on_time === 1 ? '' : 's'}, total repaid <Amount value={stats.total_repaid} />. Each on-time deal raises your limit and lowers your next deposit by 2.5 points.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
