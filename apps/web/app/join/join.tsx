'use client';
/**
 * S6 venue join (PLAN 9.3): full-screen QR poster for the booth (?screen=1), then on the phone: passkey wallet,
 * display name, risk box (the API approves the investor on-chain at once), faucet, invest a
 * small amount in the venue deal, see your name on the live counter. Email is skipped on testnet.
 */
import { QRCodeSVG } from 'qrcode.react';
import { Check, KeyRound, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatAmount, parseAmount } from '@qafila/shared';
import CountUp from '@/components/bits/CountUp';
import { Item, Stagger } from '@/components/motion/reveal';
import { Amount } from '@/components/ui/amount';
import { Button, ButtonLink } from '@/components/ui/button';
import { Callout, Card, CardBody } from '@/components/ui/card';
import { HashReveal } from '@/components/ui/hash-reveal';
import { Checkbox, Field, Input } from '@/components/ui/input';
import { EmptyState, InlineError, SkeletonCard } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { apiPost, describeError } from '@/lib/api/client';
import { useDeals, useRefreshDeal, useStats } from '@/lib/api/hooks';
import { KycResponseSchema, type KycResponse } from '@/lib/api/schemas';
import { useFlag, usePublicConfig, useToken } from '@/lib/config';
import { calls } from '@/lib/stellar/calls';
import { useWallet } from '@/lib/wallet/provider';

export function JoinScreen() {
  const { data: config, isPending } = usePublicConfig();
  const on = useFlag('FF_QR_JOIN');
  const params = useSearchParams();
  const [override, setMode] = useState<'phone' | 'screen' | null>(null);
  // ?screen=1 opens the booth view (the QR for the venue screen); a tap on the phone toggles it.
  const mode: 'phone' | 'screen' = override ?? (params.get('screen') === '1' ? 'screen' : 'phone');
  if (isPending) return <SkeletonCard lines={4} />;
  if (!config || !on) return <EmptyState title="The venue join is not open" body="This page is switched on during the event." action={<ButtonLink href="/invest" variant="outline">See the deals</ButtonLink>} />;
  if (mode === 'screen') return <BoothScreen />;
  return <PhoneFlow onShowQr={() => setMode('screen')} />;
}

const toUnits = (stroops: string) => Number(BigInt(stroops) / 100_000n) / 100;

function BoothScreen() {
  const stats = useStats();
  const url = typeof window !== 'undefined' ? `${window.location.origin}/join` : 'https://qafila.dev/join';
  return (
    <Stagger className="relative -mx-4 -my-6 flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-8 overflow-hidden px-4 py-10 text-center sm:-my-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(59,76,255,0.3),transparent_60%),radial-gradient(40%_40%_at_90%_80%,rgba(242,178,62,0.18),transparent_60%),radial-gradient(40%_40%_at_10%_80%,rgba(45,226,195,0.16),transparent_60%)]" />
      <div aria-hidden className="grid-field pointer-events-none absolute inset-0 -z-10" />
      <Item>
        <p className="eyebrow text-teal">HackMeridian 2026 · Lisbon</p>
        <h1 className="mx-auto mt-3 max-w-4xl font-display text-4xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">Own a share of a real shipment in 30 seconds.</h1>
        <p className="mt-3 text-lg text-ink-muted sm:text-xl">No crypto wallet needed. Test money.</p>
      </Item>
      <Item className="halo rounded-[1.5rem] border border-white/20 bg-white p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_30px_80px_-20px_rgba(242,178,62,0.5)]">
        <QRCodeSVG value={url} size={280} level="M" includeMargin={false} fgColor="#070a12" bgColor="#ffffff" />
      </Item>
      <Item>
        <p className="font-mono text-xl text-ink sm:text-2xl">{url.replace(/^https?:\/\//, '')}</p>
      </Item>
      {stats.data ? (
        <Item className="grid grid-cols-2 gap-8 text-center sm:grid-cols-3 sm:gap-14">
          <div>
            <p className="tabular font-display text-5xl font-bold text-teal sm:text-6xl">
              <CountUp to={stats.data.joinedDuringEvent} duration={1} trigger="load" />
            </p>
            <p className="eyebrow mt-1">joined here</p>
          </div>
          <div>
            <p className="tabular font-display text-5xl font-bold sm:text-6xl">
              <CountUp to={stats.data.walletsCreated} separator="," duration={1} trigger="load" />
            </p>
            <p className="eyebrow mt-1">wallets</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="tabular font-display text-5xl font-bold text-saffron sm:text-6xl">
              <CountUp to={toUnits(stats.data.funded)} decimals={2} separator="," duration={1.2} trigger="load" />
            </p>
            <p className="eyebrow mt-1">test dollars funded</p>
          </div>
        </Item>
      ) : null}
      <Item>
        <Link href="/join" className="text-sm text-ink-muted hover:text-ink">
          Back to the phone flow
        </Link>
      </Item>
    </Stagger>
  );
}

function PhoneFlow({ onShowQr }: { onShowQr: () => void }) {
  const w = useWallet();
  const token = useToken();
  const deals = useDeals();
  const refresh = useRefreshDeal();
  const [name, setName] = useState('');
  const [risk, setRisk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<KycResponse | null>(null);
  const [amount, setAmount] = useState('10');
  const [invested, setInvested] = useState<{ hash: string; amount: bigint } | null>(null);
  const [investing, setInvesting] = useState(false);
  const venue = useMemo(() => (deals.data ?? []).filter((d) => d.state === 'Listed').sort((a, b) => a.number - b.number)[0] ?? null, [deals.data]);

  async function join() {
    setError(null);
    try {
      const addr = w.address ?? (await w.createWallet(name.trim() || 'Guest'));
      const r = await apiPost('/join', { displayName: name.trim() || 'Guest', address: addr, riskAcknowledged: true }, KycResponseSchema);
      setJoined(r);
      refresh();
    } catch (e) {
      setError(describeError(e));
    }
  }
  async function invest() {
    if (!venue || !w.address || venue.onchainId === null) return;
    setError(null);
    setInvesting(true);
    try {
      const a = parseAmount(amount);
      const left = BigInt(venue.cost) - BigInt(venue.funded);
      if (a <= 0n || a > left) throw new Error(`Enter up to ${formatAmount(left, token.code)}.`);
      const r = await w.invoke(calls.invest(w.address, venue.onchainId, a));
      setInvested({ hash: r.hash, amount: a });
      refresh(venue.id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setInvesting(false);
    }
  }

  const current = invested ? 2 : joined ? 1 : 0;

  return (
    <Stagger className="mx-auto max-w-md space-y-5">
      <Item className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-teal">HackMeridian 2026</p>
          <h1 className="mt-1 font-display text-3xl font-bold leading-tight tracking-tight">Own a share of a real shipment</h1>
          <p className="mt-1 text-sm text-ink-muted">Passkey wallet, test dollars, one tap to invest. About 30 seconds.</p>
        </div>
        <button type="button" onClick={onShowQr} className="shrink-0 rounded-full border border-line p-2.5 text-ink-muted transition-colors hover:bg-white/[0.06] hover:text-ink" aria-label="Show the QR code for the screen">
          <QrCode className="size-5" />
        </button>
      </Item>
      <Item>
        <ol className="flex items-center gap-2" aria-label="Progress">
          {['Wallet', 'Invest', 'Done'].map((l, i) => (
            <li key={l} className="flex flex-1 items-center gap-2">
              <span className={`h-1 flex-1 rounded-full ${i < current ? 'bg-teal/60' : i === current ? 'aurora-line shadow-[0_0_12px_rgba(45,226,195,0.6)]' : 'bg-white/10'}`} />
              <span className="sr-only">{l}</span>
            </li>
          ))}
        </ol>
      </Item>

      {!joined ? (
        <Item>
          <Card className="glass-strong">
            <CardBody className="space-y-4">
              <Field label="Your name for the live counter" htmlFor="join-name">
                <Input id="join-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sara" maxLength={40} autoComplete="nickname" data-testid="join-name" />
              </Field>
              <Checkbox id="join-risk" checked={risk} onChange={(e) => setRisk(e.target.checked)} label="This is test money. In the real product I could lose what I invest if an importer does not pay; the importer's own deposit is lost first." data-testid="join-risk" />
              {error ? <InlineError>{error}</InlineError> : null}
              {w.passkeysReady ? (
                <Button size="lg" className="w-full" onClick={join} loading={w.busy} disabled={!risk} icon={<KeyRound className="size-4" />} data-testid="join-create">
                  {w.address ? 'Join' : 'Create my wallet and join'}
                </Button>
              ) : (
                <InlineError>Passkey wallets are not configured on this server.</InlineError>
              )}
              <p className="text-center text-xs text-ink-muted">Your phone asks for Face ID, fingerprint or PIN. No seed phrase, no XLM.</p>
            </CardBody>
          </Card>
        </Item>
      ) : (
        <Item>
          <Card className="glass-strong">
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-success">
                <Check className="size-4" /> You are in. Wallet approved {joined.approveTxHash ? <TxLink hash={joined.approveTxHash} short /> : null}
              </div>
              {joined.faucet ? (
                <p className="text-sm">
                  <Amount value={joined.faucet.amount} className="font-semibold" /> arrived. <TxLink hash={joined.faucet.txHash} short />
                </p>
              ) : null}
              {invested ? (
                <Callout tone="success" title={`You own a share of ${venue?.goodsSummary ?? 'the venue deal'}`}>
                  <p>
                    <Amount value={invested.amount} className="text-ink" /> invested. Watch the counter.
                  </p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                    <HashReveal hash={invested.hash} />
                    <TxLink hash={invested.hash} className="text-xs" />
                  </p>
                  <ButtonLink href={venue ? `/invest/${venue.id}` : '/invest'} size="sm" variant="outline" className="mt-2">
                    See the deal
                  </ButtonLink>
                </Callout>
              ) : venue ? (
                <div className="space-y-3">
                  <div className="rounded-[calc(var(--radius-card)-4px)] border border-line bg-white/[0.03] p-3 text-sm">
                    <p className="eyebrow">Venue deal {venue.number}</p>
                    <p className="font-medium">{venue.goodsSummary}</p>
                    <p className="text-ink-muted">
                      {venue.route.originPort} to {venue.route.destinationPort} · <Amount value={BigInt(venue.cost) - BigInt(venue.funded)} size="sm" /> left to fund
                    </p>
                  </div>
                  <Field label={`Amount (${token.label || 'test dollars'})`} htmlFor="join-amount">
                    <Input id="join-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="join-amount" className="h-14 text-2xl font-semibold sm:h-14 sm:text-2xl" autoComplete="off" />
                  </Field>
                  {error ? <InlineError>{error}</InlineError> : null}
                  <Button size="lg" className="w-full" onClick={invest} loading={investing || w.busy} disabled={!w.contractReady} icon={<KeyRound className="size-4" />} data-testid="join-invest">
                    Invest <Amount value={(() => { try { return parseAmount(amount); } catch { return 0n; } })()} className="font-semibold" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">No deal is open for funding right now. Your wallet is ready for the next one.</p>
              )}
            </CardBody>
          </Card>
        </Item>
      )}
    </Stagger>
  );
}
