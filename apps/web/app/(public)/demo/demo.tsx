'use client';
/**
 * Judges' tour (FF_DEMO_MODE): three roles, the real deals on testnet, every step on-chain.
 * "Enter as" buttons take a read-only persona session from POST /demo/session; acting (funding a
 * deal) always goes through the person's own passkey wallet on /join.
 */
import { Briefcase, ShieldCheck, KeyRound, HandHeart, FileCheck2, Landmark, Radio } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { DemoSessionResponseSchema, type DealSummary, type DemoPersona } from '@qafila/shared';
import { StateBadge } from '@/components/deal/badges';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, InlineError, SkeletonList } from '@/components/ui/states';
import { apiPost, describeError } from '@/lib/api/client';
import { useDeals } from '@/lib/api/hooks';
import { useExplorer, useFlag, usePublicConfig } from '@/lib/config';
import { writeSession } from '@/lib/session';
import { useWallet } from '@/lib/wallet/provider';

/** One line per contract state, in the words of the product. */
function story(d: DealSummary): string {
  switch (d.state) {
    case 'Listed':
      return 'Open for funding. The importer signed the purchase promise and locked a 20% deposit on-chain. Investors fund it share by share; if the cost is not reached by the deadline, everyone gets 100% back.';
    case 'Funded':
      return 'Fully funded. Next the contract pays the supplier a 30% deposit so the goods can be prepared.';
    case 'DepositPaid':
      return 'The supplier deposit is paid and the goods are being shipped. The agent watches the carrier; when the bill of lading arrives it checks it against the invoice and the loading event, then confirms on-chain and pays the balance.';
    case 'Owned':
      return 'Qafila owns the goods. The importer signs the sale at the fixed price; her deposit counts as the first payment and the rest is due by the date on the deal.';
    case 'Sold':
      return 'Sold at the fixed price. Repayment is running; a late payment adds a fixed fee that goes to charity, never to investors.';
    case 'Repaid':
      return 'Repaid. Investors claim their principal plus the fixed profit; nothing grew with time.';
    case 'Cancelled':
      return 'Cancelled before the goods were bought: every investor and the importer get everything back.';
    case 'Defaulted':
    case 'Liquidated':
      return 'The importer did not pay. Losses follow the published order: her deposit first, then recoveries, then investors pro rata, with Qafila’s own 5% share.';
    default:
      if (d.status === 'rejected') return 'Rejected by the screening. Open the ops view to see the failing check and its evidence.';
      if (d.status === 'review') return 'The AI flagged something and a person decides. Ops see the check, the evidence and the policy rule that fired.';
      if (d.status === 'approved' || d.status === 'promised') return 'Screened and approved. Waiting for the importer’s signed promise and deposit before it is listed.';
      return 'A deal in progress.';
  }
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-100 font-mono text-xs text-teal">{n}</span>
      <span>{children}</span>
    </li>
  );
}

export function DemoPage() {
  const cfg = usePublicConfig();
  const on = useFlag('FF_DEMO_MODE');
  const deals = useDeals();
  const explorer = useExplorer();
  const w = useWallet();
  const [busy, setBusy] = useState<DemoPersona | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enter(persona: DemoPersona) {
    setBusy(persona);
    setError(null);
    try {
      const s = await apiPost('/demo/session', { persona }, DemoSessionResponseSchema);
      writeSession({ token: s.token, address: s.address, kind: 'demo', label: s.label });
      // A full navigation so the wallet provider restores the new session.
      window.location.assign(persona === 'ops' ? '/ops' : '/importer');
    } catch (e) {
      setError(describeError(e));
      setBusy(null);
    }
  }

  if (cfg.isPending) return <SkeletonList count={4} />;
  if (cfg.isError) return <ErrorState title="Could not load the configuration" body={describeError(cfg.error)} onRetry={() => void cfg.refetch()} />;
  if (!on) return <EmptyState title="The demo tour is off on this server" body="Create a wallet to use the app, or ask the team to switch the tour on." />;

  const inDemo = w.kind === 'demo';
  const sorted = [...(deals.data ?? [])].sort((a, b) => a.number - b.number);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="For the judges"
        title="Walk through Qafila in five minutes"
        lead="Three roles, real deals on Stellar testnet, every step on-chain. Pick a story below. Everything here is test money."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass-strong hairline-top">
          <CardHeader eyebrow="Story 1, two minutes" title="Fund a shipment yourself" action={<KeyRound className="size-5 text-saffron" aria-hidden />} />
          <CardBody className="space-y-4 text-sm">
            <ol className="space-y-2">
              <Step n={1}>Open the join page and create a passkey wallet with your face or fingerprint. No seed phrase, no XLM; it takes about 20 seconds and sends you 50 test dollars.</Step>
              <Step n={2}>Pick an open deal, read the terms and the AI report, and invest 10 test dollars. Your name appears on the live counter.</Step>
              <Step n={3}>Open your portfolio: your shares are a locked receipt token on Stellar, one per test dollar, with the transaction link.</Step>
            </ol>
            <Link href="/join" className={buttonClasses('primary', 'md', 'w-full')} data-testid="demo-join">
              Start on the join page
            </Link>
          </CardBody>
        </Card>

        <Card className="hairline-top">
          <CardHeader eyebrow="Story 2, read-only" title="See the importer’s desk" action={<Briefcase className="size-5 text-teal" aria-hidden />} />
          <CardBody className="space-y-4 text-sm">
            <ul className="space-y-1.5 text-ink-muted">
              <li>The deals below in the importer workspace, each at its own step: funding, shipping, the sale, repayment.</li>
              <li>Payments with their transaction links, carrier tracking, the signed promise and the locked deposit.</li>
              <li>The trade file: documents, the signed report and every transaction in one bundle for a bank.</li>
            </ul>
            <Button variant="outline" className="w-full" onClick={() => void enter('importer')} loading={busy === 'importer'} disabled={busy !== null} data-testid="demo-importer">
              Enter as the importer
            </Button>
          </CardBody>
        </Card>

        <Card className="hairline-top">
          <CardHeader eyebrow="Story 3, read-only" title="See the ops console" action={<ShieldCheck className="size-5 text-indigo" aria-hidden />} />
          <CardBody className="space-y-4 text-sm">
            <ul className="space-y-1.5 text-ink-muted">
              <li>The queue: what each deal waits for, incidents, and company registrations pending approval.</li>
              <li>A deal review: checks and evidence, the policy table that decides, the audit log and the agent’s actions.</li>
              <li>Health: adapters, indexer lag, the relayer and the agent wallets.</li>
            </ul>
            <Button variant="outline" className="w-full" onClick={() => void enter('ops')} loading={busy === 'ops'} disabled={busy !== null} data-testid="demo-ops">
              Enter as ops
            </Button>
          </CardBody>
        </Card>
      </div>

      {error ? <InlineError>{error}</InlineError> : null}
      <p className="text-sm text-ink-muted">
        {inDemo
          ? 'You are in a demo view. It is read-only; the account menu signs you out.'
          : 'Entering a demo view replaces your current session with a read-only one. Sign out from the account menu to leave it; to act, create your own wallet.'}
      </p>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">The deals and where each one stands</h2>
        {deals.isPending ? (
          <SkeletonList count={3} />
        ) : deals.isError ? (
          <ErrorState title="Could not load the deals" body={describeError(deals.error)} onRetry={() => void deals.refetch()} />
        ) : sorted.length === 0 ? (
          <EmptyState title="No deals listed yet" body="The demo deals are listed before the judging session." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {sorted.map((d) => (
              <Card key={d.id} className="p-5" data-testid={`demo-deal-${d.number}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="eyebrow">Deal {d.number}</p>
                  <StateBadge state={d.state} fallback={d.status} />
                </div>
                <h3 className="mt-2 font-display text-base font-semibold leading-snug">{d.goodsSummary}</h3>
                <p className="mt-1 text-xs text-ink-muted">
                  {d.route.originPort} to {d.route.destinationPort}
                </p>
                <p className="mt-3 text-sm text-ink-muted">{story(d)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/deals/${d.number}`} className={buttonClasses('ghost', 'sm')}>
                    Public page
                  </Link>
                  {d.state === 'Listed' ? (
                    <Link href={`/invest/${d.id}`} className={buttonClasses('outline', 'sm')}>
                      Invest
                    </Link>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">Proof you can check yourself</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/charity" className="glass rounded-card p-4 transition-colors hover:border-white/20">
            <HandHeart className="size-5 text-saffron" aria-hidden />
            <p className="mt-3 font-medium">Charity ledger</p>
            <p className="mt-1 text-xs text-ink-muted">Every late fee and every rounding cent, with its transaction.</p>
          </Link>
          <Link href="/verifier" className="glass rounded-card p-4 transition-colors hover:border-white/20">
            <FileCheck2 className="size-5 text-teal" aria-hidden />
            <p className="mt-3 font-medium">Verifier key</p>
            <p className="mt-1 text-xs text-ink-muted">Every AI report is signed; any contract can verify one on-chain.</p>
          </Link>
          {cfg.data.contractId && explorer.contract(cfg.data.contractId) ? (
            <a href={explorer.contract(cfg.data.contractId) ?? '#'} target="_blank" rel="noreferrer" className="glass rounded-card p-4 transition-colors hover:border-white/20">
              <Landmark className="size-5 text-indigo" aria-hidden />
              <p className="mt-3 font-medium">The contract on stellar.expert</p>
              <p className="mt-1 text-xs text-ink-muted">Soroban, in Rust. Every state change is an event.</p>
            </a>
          ) : null}
          {cfg.data.flags.FF_X402 ? (
            <Link href="/verifier" className="glass rounded-card p-4 transition-colors hover:border-white/20">
              <Radio className="size-5 text-success" aria-hidden />
              <p className="mt-3 font-medium">Paid verification over x402</p>
              <p className="mt-1 text-xs text-ink-muted">Other lenders’ agents buy a check for 0.50 USDC; the verifier page says how.</p>
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
