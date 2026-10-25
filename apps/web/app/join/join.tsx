'use client';
/**
 * S6 venue join (PLAN 9.3): full-screen QR for the booth, then on the phone: passkey wallet,
 * display name, risk box (the API approves the investor on-chain at once), faucet, invest a
 * small amount in the venue deal, see your name on the live counter. Email is skipped on testnet.
 */
import { QRCodeSVG } from 'qrcode.react';
import { Check, KeyRound, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatAmount, parseAmount } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Button, ButtonLink } from '@/components/ui/button';
import { Callout, Card, CardBody } from '@/components/ui/card';
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
  const [mode, setMode] = useState<'phone' | 'screen'>('phone');
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('screen') === '1') setMode('screen');
  }, []);
  if (isPending) return <SkeletonCard lines={4} />;
  if (!config || !on) return <EmptyState title="The venue join is not open" body="This page is switched on during the event." action={<ButtonLink href="/invest" variant="outline">See the deals</ButtonLink>} />;
  if (mode === 'screen') return <BoothScreen />;
  return <PhoneFlow onShowQr={() => setMode('screen')} />;
}

function BoothScreen() {
  const stats = useStats();
  const url = typeof window !== 'undefined' ? `${window.location.origin}/join` : 'https://qafila.dev/join';
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-8 text-center">
      <div>
        <p className="eyebrow">HackMeridian 2026</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Own a share of a real shipment in 30 seconds.</h1>
        <p className="mt-2 text-lg text-ink-muted">No crypto wallet needed. Test money.</p>
      </div>
      <div className="rounded-card border border-line bg-white p-6 shadow-card">
        <QRCodeSVG value={url} size={280} level="M" includeMargin={false} fgColor="#1b2a4a" />
      </div>
      <p className="font-mono text-lg">{url.replace(/^https?:\/\//, '')}</p>
      {stats.data ? (
        <div className="grid grid-cols-2 gap-6 text-center sm:grid-cols-3">
          <div>
            <p className="tabular text-4xl font-semibold">{stats.data.joinedDuringEvent}</p>
            <p className="eyebrow">joined here</p>
          </div>
          <div>
            <p className="tabular text-4xl font-semibold">{stats.data.walletsCreated}</p>
            <p className="eyebrow">wallets</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="tabular text-4xl font-semibold">{formatAmount(stats.data.funded, '').trim()}</p>
            <p className="eyebrow">test dollars funded</p>
          </div>
        </div>
      ) : null}
      <Link href="/join" className="text-sm text-ink-muted hover:underline">
        Back to the phone flow
      </Link>
    </div>
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

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">HackMeridian 2026</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Own a share of a real shipment</h1>
          <p className="mt-1 text-sm text-ink-muted">Passkey wallet, test dollars, one tap to invest. About 30 seconds.</p>
        </div>
        <button type="button" onClick={onShowQr} className="rounded-md p-2 text-ink-muted hover:bg-sand-200" aria-label="Show the QR code for the screen">
          <QrCode className="size-5" />
        </button>
      </div>

      {!joined ? (
        <Card>
          <CardBody className="space-y-4">
            <Field label="Your name for the live counter" htmlFor="join-name">
              <Input id="join-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sara" maxLength={40} data-testid="join-name" />
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
      ) : (
        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-success">
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
                  <Amount value={invested.amount} /> invested. Watch the counter. <TxLink hash={invested.hash} />
                </p>
                <ButtonLink href={venue ? `/invest/${venue.id}` : '/invest'} size="sm" variant="outline" className="mt-2">
                  See the deal
                </ButtonLink>
              </Callout>
            ) : venue ? (
              <div className="space-y-3">
                <div className="rounded-md bg-surface-2 p-3 text-sm">
                  <p className="eyebrow">Venue deal {venue.number}</p>
                  <p className="font-medium">{venue.goodsSummary}</p>
                  <p className="text-ink-muted">
                    {venue.route.originPort} to {venue.route.destinationPort} · <Amount value={BigInt(venue.cost) - BigInt(venue.funded)} size="sm" /> left to fund
                  </p>
                </div>
                <Field label={`Amount (${token.label || 'test dollars'})`} htmlFor="join-amount">
                  <Input id="join-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="join-amount" />
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
      )}
    </div>
  );
}
