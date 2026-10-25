'use client';
import { readSession } from '@/lib/session';
/**
 * Passkey onboarding (PLAN 4.1, 9.2): one button creates the wallet, then role, then KYC-lite
 * or KYB, then the testnet faucet. Target: under 30 seconds on a phone. No seed phrase, no XLM.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Briefcase, Check, KeyRound, LineChart, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { KycRequest, RegisterDocumentRequest, formatAmount, shortAddress } from '@qafila/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Callout, Card, CardBody } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import { InlineError, InlineNotice } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { apiPost, describeError, sha256File, uploadToSignedUrl } from '@/lib/api/client';
import { useMe } from '@/lib/api/hooks';
import { KybRequest, KycResponseSchema, RegisterDocumentResponseSchema, type KycResponse } from '@/lib/api/schemas';
import { useToken } from '@/lib/config';
import { COUNTRIES } from '@/lib/countries';
import { useWallet } from '@/lib/wallet/provider';
import { cn } from '@/lib/utils';

type Step = 'wallet' | 'role' | 'investor' | 'importer' | 'done';

export function Onboarding() {
  const params = useSearchParams();
  const router = useRouter();
  const w = useWallet();
  const me = useMe();
  const mode = params.get('mode');
  const next = params.get('next');
  const roleParam = params.get('role');
  const [step, setStep] = useState<Step>('wallet');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [result, setResult] = useState<KycResponse | null>(null);
  const [kind, setKind] = useState<'investor' | 'importer' | null>(null);
  const started = useRef<number | null>(null);
  const [label, setLabel] = useState('');

  // Already connected: the wallet step is skipped by derivation, no state update needed.
  const alreadyDone = w.status === 'connected' && me.data?.profile.kycStatus === 'approved' && Boolean(me.data?.profile.displayName);
  const shown: Step = step !== 'wallet' || w.status !== 'connected' ? step : alreadyDone ? 'done' : roleParam === 'importer' ? 'importer' : roleParam === 'investor' ? 'investor' : 'role';
  useEffect(() => {
    if (alreadyDone && next && step === 'wallet') router.replace(next);
  }, [alreadyDone, next, router, step]);

  async function create() {
    setError(null);
    started.current = performance.now();
    try {
      await w.createWallet(label.trim() || 'My wallet');
      setElapsed(Math.round((performance.now() - started.current) / 1000));
    } catch (e) {
      setError(describeError(e));
    }
  }
  async function signIn() {
    setError(null);
    try {
      await w.signIn();
    } catch (e) {
      setError(describeError(e));
    }
  }
  async function external() {
    setError(null);
    try {
      await w.connectExternal();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Steps current={shown} />

      {shown === 'wallet' ? (
        <Card className="rise">
          <CardBody className="space-y-5 p-6">
            <div>
              <p className="eyebrow">Step 1</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{mode === 'signin' ? 'Sign in' : 'Your wallet is a passkey'}</h1>
              <p className="mt-2 text-sm text-ink-muted">
                {mode === 'signin'
                  ? 'Use the passkey you created before. Your wallet comes back with it.'
                  : 'Face, fingerprint or device PIN. No seed phrase to write down, no XLM to buy. Fees are paid for you.'}
              </p>
            </div>
            {mode !== 'signin' && w.passkeysReady ? (
              <Field label="What should we call you?" htmlFor="label" hint="Shown on your passkey and on the live counter.">
                <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Amina" maxLength={40} autoComplete="nickname" data-testid="onb-label" />
              </Field>
            ) : null}
            {error ? <InlineError>{error}</InlineError> : null}
            <div className="flex flex-col gap-2">
              {w.passkeysReady ? (
                mode === 'signin' ? (
                  <Button size="lg" onClick={signIn} loading={w.busy} icon={<KeyRound className="size-4" />} data-testid="onb-signin">
                    Sign in with my passkey
                  </Button>
                ) : (
                  <Button size="lg" onClick={create} loading={w.busy} icon={<KeyRound className="size-4" />} data-testid="onb-create">
                    Create my wallet
                  </Button>
                )
              ) : (
                <InlineNotice tone="warning">Passkey wallets are not configured on this server yet. You can connect a Stellar wallet instead.</InlineNotice>
              )}
              <div className="flex flex-wrap gap-2">
                {w.passkeysReady ? (
                  mode === 'signin' ? (
                    <Link href="/onboarding" className="text-sm text-indigo underline-offset-2 hover:underline">
                      New here? Create a wallet
                    </Link>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={signIn} disabled={w.busy} data-testid="onb-signin-inline">
                      I already have a wallet
                    </Button>
                  )
                ) : null}
                <Button variant="ghost" size="sm" onClick={external} disabled={w.busy} icon={<Wallet className="size-4" />} data-testid="onb-freighter">
                  Use Freighter or another wallet
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {shown !== 'wallet' && w.address ? (
        <div className="flex items-center justify-between rounded-card border border-success/30 bg-success-100 px-4 py-2.5 text-sm" data-testid="onb-wallet-ready">
          <span className="flex items-center gap-2">
            <Check className="size-4 text-success" />
            Wallet ready{elapsed !== null ? ` in ${elapsed} s` : ''}
          </span>
          <span className="font-mono text-xs" title={w.address}>
            {shortAddress(w.address, 6, 6)}
          </span>
        </div>
      ) : null}

      {shown === 'role' ? (
        <div className="grid gap-3 sm:grid-cols-2 rise">
          <RoleCard icon={<LineChart className="size-5" />} title="I want to invest" body="Fund a shipment and earn a share of its fixed profit." onClick={() => setStep('investor')} testId="onb-role-investor" />
          <RoleCard icon={<Briefcase className="size-5" />} title="I import goods" body="Ask Qafila to buy goods for you and pay a fixed price later." onClick={() => setStep('importer')} testId="onb-role-importer" />
        </div>
      ) : null}

      {shown === 'investor' ? (
        <InvestorForm
          defaultName={w.label ?? ''}
          onDone={(r) => {
            setResult(r);
            setKind('investor');
            setStep('done');
          }}
          onBack={() => setStep('role')}
        />
      ) : null}
      {shown === 'importer' ? (
        <ImporterForm
          defaultName={w.label ?? ''}
          onDone={(r) => {
            setResult(r);
            setKind('importer');
            setStep('done');
          }}
          onBack={() => setStep('role')}
        />
      ) : null}

      {shown === 'done' ? <Done result={result} kind={kind ?? (me.data?.importer ? 'importer' : 'investor')} next={next} /> : null}
    </div>
  );
}

function Steps({ current }: { current: Step }) {
  const order: Step[] = ['wallet', 'role', 'investor', 'done'];
  const idx = current === 'importer' ? 2 : order.indexOf(current);
  const labels = ['Wallet', 'Role', 'Details', 'Ready'];
  return (
    <ol className="flex items-center gap-2 text-xs text-ink-muted" aria-label="Progress">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2">
          <span className={cn('flex size-5 items-center justify-center rounded-full border text-[10px] font-medium', i < idx ? 'border-success bg-success text-white' : i === idx ? 'border-indigo text-indigo' : 'border-line')}>{i < idx ? <Check className="size-3" /> : i + 1}</span>
          <span className={i === idx ? 'font-medium text-ink' : ''}>{l}</span>
          {i < labels.length - 1 ? <span aria-hidden className="h-px w-4 bg-line sm:w-8" /> : null}
        </li>
      ))}
    </ol>
  );
}

function RoleCard({ icon, title, body, onClick, testId }: { icon: React.ReactNode; title: string; body: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className="rounded-card border border-line bg-surface p-5 text-left shadow-card transition-colors hover:border-indigo-300 hover:bg-sand-100">
      <span className="flex size-9 items-center justify-center rounded-full bg-indigo-50 text-indigo">{icon}</span>
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{body}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-sm text-indigo">
        Continue <ArrowRight className="size-4" />
      </span>
    </button>
  );
}

const KycForm = KycRequest.extend({ email: z.string().email('Enter a valid email or leave it empty.').or(z.literal('')).optional(), riskAcknowledged: z.boolean().refine((v) => v, 'Tick the box to continue.') });
type KycForm = z.infer<typeof KycForm>;

function InvestorForm({ defaultName, onDone, onBack }: { defaultName: string; onDone: (r: KycResponse) => void; onBack: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<KycForm>({ resolver: zodResolver(KycForm), defaultValues: { displayName: defaultName, country: 'PT', email: '', riskAcknowledged: false } });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const body = { displayName: v.displayName, country: v.country, email: v.email ? v.email : undefined, riskAcknowledged: true as const };
      const session = readSession();
      // Wallet-only visitors (no email code yet) take the passkey-only path: the API approves the investor on-chain and sends the faucet grant (PLAN 4.4, S6).
      const walletOnly = !session.token || session.token.startsWith('mock.');
      onDone(walletOnly && session.address ? await apiPost('/join', { ...body, address: session.address }, KycResponseSchema) : await apiPost('/kyc', body, KycResponseSchema));
    } catch (e) {
      setError(describeError(e));
    }
  });
  return (
    <Card className="rise">
      <form onSubmit={submit} className="space-y-4 p-6" noValidate>
        <div>
          <p className="eyebrow">Step 3</p>
          <h2 className="mt-1 text-xl font-semibold">A few details</h2>
          <p className="mt-1 text-sm text-ink-muted">Testnet sign-up: your wallet is approved to invest right away and receives test dollars.</p>
        </div>
        <Field label="Name" htmlFor="displayName" error={form.formState.errors.displayName?.message}>
          <Input id="displayName" {...form.register('displayName')} autoComplete="name" data-testid="kyc-name" />
        </Field>
        <Field label="Country" htmlFor="country" error={form.formState.errors.country?.message}>
          <Select id="country" {...form.register('country')} data-testid="kyc-country">
            {COUNTRIES.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Email (optional)" htmlFor="email" hint="Only for notifications when a deal pays out." error={form.formState.errors.email?.message}>
          <Input id="email" type="email" {...form.register('email')} autoComplete="email" inputMode="email" />
        </Field>
        <Checkbox id="risk" {...form.register('riskAcknowledged')} data-testid="kyc-risk" label={<span>I understand that I can lose money if an importer does not pay, that losses are shared after the importer&apos;s own money, and that my shares cannot be sold before the deal ends.</span>} />
        {form.formState.errors.riskAcknowledged ? <p className="text-xs text-danger">{form.formState.errors.riskAcknowledged.message}</p> : null}
        {error ? <InlineError>{error}</InlineError> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" loading={form.formState.isSubmitting} data-testid="kyc-submit">
            Finish sign-up
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </form>
    </Card>
  );
}

const KybForm = KybRequest.omit({ documentId: true }).extend({ email: z.string().email().or(z.literal('')).optional() });
type KybForm = z.infer<typeof KybForm>;

function ImporterForm({ defaultName, onDone, onBack }: { defaultName: string; onDone: (r: KycResponse) => void; onBack: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const form = useForm<KybForm>({ resolver: zodResolver(KybForm), defaultValues: { displayName: defaultName, legalName: '', country: 'NG', registrationNumber: '', email: '' } });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      let documentId: string | null = null;
      if (file) {
        const reg = RegisterDocumentRequest.parse({ type: 'kyb', filename: file.name, mime: file.type, size: file.size, sha256: await sha256File(file) });
        const r = await apiPost('/kyb/documents', reg, RegisterDocumentResponseSchema);
        await uploadToSignedUrl(r.uploadUrl, r.method, r.headers, file);
        documentId = r.documentId;
      }
      const body = { legalName: v.legalName, country: v.country, registrationNumber: v.registrationNumber, displayName: v.displayName, email: v.email ? v.email : undefined, documentId };
      onDone(await apiPost('/kyb', body, KycResponseSchema));
    } catch (e) {
      setError(describeError(e));
    }
  });
  return (
    <Card className="rise">
      <form onSubmit={submit} className="space-y-4 p-6" noValidate>
        <div>
          <p className="eyebrow">Step 3</p>
          <h2 className="mt-1 text-xl font-semibold">Register your company</h2>
          <p className="mt-1 text-sm text-ink-muted">Ops checks the registration before your first deal. On testnet, approval also sends you enough test dollars for a deposit and a repayment.</p>
        </div>
        <Field label="Your name" htmlFor="displayName" error={form.formState.errors.displayName?.message}>
          <Input id="displayName" {...form.register('displayName')} data-testid="kyb-name" />
        </Field>
        <Field label="Company legal name" htmlFor="legalName" error={form.formState.errors.legalName?.message}>
          <Input id="legalName" {...form.register('legalName')} placeholder="Amina Trading Ltd" data-testid="kyb-legal" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country" htmlFor="country" error={form.formState.errors.country?.message}>
            <Select id="country" {...form.register('country')}>
              {COUNTRIES.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Registration number" htmlFor="registrationNumber" error={form.formState.errors.registrationNumber?.message}>
            <Input id="registrationNumber" {...form.register('registrationNumber')} placeholder="RC-1736620" data-testid="kyb-reg" />
          </Field>
        </div>
        <Field label="Registration document (PDF or photo)" htmlFor="kybdoc" hint="Up to 15 MB. Stored privately; only ops can open it.">
          <Input id="kybdoc" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-2" />
        </Field>
        <Field label="Email (optional)" htmlFor="kemail" hint="For notifications when your deal moves." error={form.formState.errors.email?.message}>
          <Input id="kemail" type="email" {...form.register('email')} inputMode="email" />
        </Field>
        {error ? <InlineError>{error}</InlineError> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" loading={form.formState.isSubmitting} data-testid="kyb-submit">
            Submit for approval
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Done({ result, kind, next }: { result: KycResponse | null; kind: 'investor' | 'importer'; next: string | null }) {
  const token = useToken();
  const pending = result?.kycStatus === 'pending';
  return (
    <Card className="rise" data-testid="onb-done">
      <CardBody className="space-y-4 p-6">
        <div>
          <p className="eyebrow">Ready</p>
          <h2 className="mt-1 text-xl font-semibold">{pending ? 'Thanks. Ops will check your registration.' : kind === 'importer' ? 'You are set up as an importer.' : 'You can invest.'}</h2>
        </div>
        {result?.approveTxHash ? (
          <Callout tone="success" title="Your wallet is approved to invest">
            <p>
              The approval is on-chain. <TxLink hash={result.approveTxHash} />
            </p>
          </Callout>
        ) : null}
        {result?.faucet ? (
          <Callout tone="indigo" title={`${formatAmount(result.faucet.amount, token.code)} arrived`}>
            <p>
              Test dollars for the hackathon, not real money. <TxLink hash={result.faucet.txHash} />
            </p>
          </Callout>
        ) : null}
        {pending ? (
          <Callout tone="neutral">
            <p>You can already draft a deal and upload documents. Listing waits for the approval. On testnet the faucet grant arrives with it.</p>
          </Callout>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {next ? <ButtonLink href={next}>Continue</ButtonLink> : null}
          {kind === 'importer' ? <ButtonLink href="/importer" variant={next ? 'outline' : 'primary'}>Go to my deals</ButtonLink> : <ButtonLink href="/invest" variant={next ? 'outline' : 'primary'}>See the deals</ButtonLink>}
          <ButtonLink href="/settings" variant="ghost">
            Add a backup passkey
          </ButtonLink>
        </div>
      </CardBody>
    </Card>
  );
}
