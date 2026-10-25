'use client';
/**
 * Importer deal workspace: one page, driven by the deal's stage. Documents and terms, screening,
 * report with fixes, promise with the security deposit, funding, shipment, sign sale, repay,
 * late fee, money to collect, plus the public timeline and tracking (FLOWS I-2 to I-10).
 */
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, Play, Ship } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { JobStatusSchema, bpsToPercent, formatAmount, parseAmount, type DocumentType } from '@qafila/shared';
import { RequireWallet } from '@/components/require-wallet';
import { FundingProgress } from '@/components/deal/funding-progress';
import { OnchainTimeline } from '@/components/deal/onchain-timeline';
import { PaymentsList } from '@/components/deal/payments-list';
import { TrackingEvents } from '@/components/deal/tracking-events';
import { DocumentUpload } from '@/components/importer/document-upload';
import { MoneyToCollect } from '@/components/importer/money-to-collect';
import { PromiseStep } from '@/components/importer/promise-step';
import { LateFeeCard, RepayPanel } from '@/components/importer/repay-panel';
import { ReportView } from '@/components/importer/report-view';
import { ShipmentStep } from '@/components/importer/shipment-step';
import { SignSale } from '@/components/importer/sign-sale';
import { StageBadge, STAGE_LABEL } from '@/components/importer/stage-badge';
import { WithdrawPromise } from '@/components/importer/withdraw-promise';
import { Amount } from '@/components/ui/amount';
import { Button, ButtonLink } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { KV } from '@/components/ui/kv';
import { EmptyState, ErrorState, InlineError, Skeleton, SkeletonCard } from '@/components/ui/states';
import { apiGet, apiPatch, apiPost, ApiRequestError, describeError } from '@/lib/api/client';
import { useImporterDeal, useRefreshDeal, useTradeFile } from '@/lib/api/hooks';
import { ImporterDealSchema, VerifyResponseSchema, type ImporterDealDetail } from '@/lib/api/schemas';
import { useFlag, usePublicConfig, useToken } from '@/lib/config';
import { formatDateTime, humanDuration } from '@/lib/utils';

export function ImporterDealScreen({ id }: { id: string }) {
  return (
    <RequireWallet title="Connect to see this deal">
      <Inner id={id} />
    </RequireWallet>
  );
}

function Inner({ id }: { id: string }) {
  const q = useImporterDeal(id);
  if (q.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <SkeletonCard lines={6} />
        <SkeletonCard lines={4} />
      </div>
    );
  }
  if (q.isError) {
    if (q.error instanceof ApiRequestError && (q.error.status === 404 || q.error.status === 403)) {
      return <EmptyState title="This deal is not yours or does not exist" action={<ButtonLink href="/importer" variant="outline">Back to my deals</ButtonLink>} />;
    }
    return <ErrorState title="Could not load the deal" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  }
  const deal = q.data;
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/importer" className="eyebrow hover:underline">
            My deals
          </Link>
          <span className="text-ink-faint">/</span>
          <p className="eyebrow">Deal {deal.number}</p>
          <StageBadge stage={deal.stage} />
        </div>
        <h1 className="max-w-3xl font-display text-3xl font-bold leading-[1.05] tracking-tight sm:text-4xl">{deal.goodsSummary}</h1>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
          <Ship className="size-4" aria-hidden /> {deal.route.originPort} <ArrowRight className="size-3.5" aria-hidden /> {deal.route.destinationPort} · {deal.supplier.nameEn}
          {deal.state ? (
            <Link href={`/deals/${deal.id}`} className="inline-flex items-center gap-1 text-indigo hover:underline">
              Public page <ExternalLink className="size-3.5" />
            </Link>
          ) : null}
        </p>
        <p className="inline-flex items-center gap-2 rounded-full border border-saffron/25 bg-saffron-100 px-3 py-1 text-sm font-medium text-saffron-700"><span aria-hidden className="live-dot size-1.5 rounded-full bg-saffron" />{deal.nextAction}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <StagePanel deal={deal} />
          {deal.state ? <PaymentsList payments={deal.payments} /> : null}
          {deal.tracking ? <TrackingEvents tracking={deal.tracking} /> : null}
          {deal.state ? <OnchainTimeline timeline={deal.timeline} /> : null}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <MoneyToCollect amount={deal.refundOwed} />
          <Summary deal={deal} />
          <TradeFile deal={deal} />
        </aside>
      </div>
    </div>
  );
}

function StagePanel({ deal }: { deal: ImporterDealDetail }) {
  switch (deal.stage) {
    case 'draft':
      return <DraftStep deal={deal} />;
    case 'verifying':
      return <Verifying deal={deal} />;
    case 'review':
    case 'rejected':
      return <ReportView deal={deal} />;
    case 'approved':
      return (
        <div className="space-y-4">
          <ReportView deal={deal} />
          <PromiseStep deal={deal} />
        </div>
      );
    case 'promised':
      return <WithdrawPromise deal={deal} />;
    case 'listed':
      return (
        <Card>
          <CardHeader eyebrow="Step 7" title="Investors are funding your deal" />
          <CardBody className="space-y-3">
            <FundingProgress funded={deal.funded} cost={deal.cost} />
            <p className="text-sm text-ink-muted">Once the cost is reached the supplier deposit is paid automatically. If the deadline passes first, everyone including you gets 100% back.</p>
          </CardBody>
        </Card>
      );
    case 'funded':
      return (
        <Card>
          <CardHeader eyebrow="Step 8" title="Funded. The supplier deposit is being paid." />
          <CardBody className="text-sm text-ink-muted">The agent pays the agreed deposit to {deal.supplier.nameEn} once the registry and sanctions checks are confirmed. Tell your supplier to prepare the shipment to the order of Qafila Trade, deal {deal.number}.</CardBody>
        </Card>
      );
    case 'deposit_paid':
      return deal.shipment ? (
        <Card>
          <CardHeader eyebrow="Step 9" title="Shipment under review" />
          <CardBody className="text-sm text-ink-muted">
            Bill of lading {deal.shipment.blNumber} ({deal.shipment.carrier}) uploaded. The agent matches it with the carrier&apos;s loading event, then pays the balance to the supplier. Tracking below updates as the carrier reports.
          </CardBody>
        </Card>
      ) : (
        <ShipmentStep deal={deal} />
      );
    case 'owned':
      return <SignSale deal={deal} />;
    case 'sold':
      return <RepayPanel deal={deal} />;
    case 'repaid':
    case 'closed':
      return (
        <div className="space-y-4">
          <LateFeeCard deal={deal} />
          <Card>
            <CardHeader eyebrow="Done" title="Price fully repaid" />
            <CardBody className="text-sm text-ink-muted">Investors claim their principal and profit. Every on-time repayment lowers your next deposit and raises your limit.</CardBody>
          </Card>
        </div>
      );
    case 'cancelled':
      return (
        <Card>
          <CardHeader eyebrow="Cancelled" title="This deal did not go ahead" />
          <CardBody className="text-sm text-ink-muted">Funding was not reached or ops stopped it before any payment. Nobody loses anything: your deposit comes back in full (see Money to collect) and investors are refunded.</CardBody>
        </Card>
      );
    case 'defaulted':
    case 'liquidated':
      return (
        <Callout tone="danger" title={STAGE_LABEL[deal.stage]}>
          <p>Ops is handling recovery. Your deposit covers only the actual loss; anything left comes back under Money to collect. Contact ops for the recovery notes.</p>
        </Callout>
      );
    default:
      return null;
  }
}

const DOCS: DocumentType[] = ['invoice', 'packing_list', 'business_licence'];

function DraftStep({ deal }: { deal: ImporterDealDetail }) {
  const refresh = useRefreshDeal();
  const token = useToken();
  const { data: config } = usePublicConfig();
  const [cost, setCost] = useState(BigInt(deal.terms.cost) > 0n ? formatAmount(deal.terms.cost, '').trim().replaceAll(',', '') : '');
  const [markupBps, setMarkupBps] = useState(BigInt(deal.terms.cost) > 0n ? Number((BigInt(deal.terms.markup) * 10000n) / BigInt(deal.terms.cost)) : 800);
  const [tenor, setTenor] = useState(String(Math.round(deal.terms.tenorSecs / 86_400)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const uploaded = DOCS.every((t) => deal.documents.some((d) => d.type === t && d.status === 'uploaded'));
  const costOk = useMemo(() => {
    try {
      return parseAmount(cost) > 0n;
    } catch {
      return false;
    }
  }, [cost]);
  const hasTerms = BigInt(deal.terms.cost) > 0n;

  async function saveTerms() {
    setError(null);
    setSaving(true);
    try {
      const c = parseAmount(cost);
      await apiPatch(`/deals/${deal.id}`, { cost: c.toString(), markup: ((c * BigInt(markupBps)) / 10000n).toString(), tenorSecs: Number(tenor) * 86_400 }, ImporterDealSchema);
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }
  async function start() {
    setError(null);
    setStarting(true);
    try {
      await apiPost(`/deals/${deal.id}/verify`, {}, VerifyResponseSchema);
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setStarting(false);
    }
  }
  const maxMarkup = config ? 1500 : 1500;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader eyebrow="Step 2" title="Upload your supplier's documents" />
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-muted">AI reads them and checks them against each other, the company registry, sanctions lists and reference prices. Investors never see the files, only the checks.</p>
          {DOCS.map((t) => (
            <DocumentUpload key={t} dealId={deal.id} type={t} existing={deal.documents.find((d) => d.type === t)} onUploaded={() => refresh(deal.id)} />
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader eyebrow="Step 3" title="Terms" />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`Cost of the goods (${token.label || 'test dollars'})`} htmlFor="cost" hint="The invoice total. Screening compares it with the documents.">
              <Input id="cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="2000" data-testid="terms-cost" />
            </Field>
            <Field label="Markup" htmlFor="markup" hint={`Fixed profit, up to ${bpsToPercent(maxMarkup)}. Investors receive it minus the platform fee.`}>
              <Select id="markup" value={markupBps} onChange={(e) => setMarkupBps(Number(e.target.value))}>
                {[500, 600, 700, 800, 1000, 1200, 1500].map((b) => (
                  <option key={b} value={b}>
                    {bpsToPercent(b)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tenor" htmlFor="tenor2">
              <Select id="tenor2" value={tenor} onChange={(e) => setTenor(e.target.value)}>
                {[30, 45, 60, 75, 90, 120].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {costOk ? (
            <KV
              dense
              rows={[
                { k: 'Fixed sale price', v: <Amount value={parseAmount(cost) + (parseAmount(cost) * BigInt(markupBps)) / 10000n} /> },
                { k: 'Security deposit at the promise', v: hasTerms ? <span><Amount value={deal.security} /> ({bpsToPercent(Number((BigInt(deal.security) * 10000n) / BigInt(deal.terms.cost)))})</span> : 'computed when you save' },
                hasTerms ? { k: 'Platform fee (inside the markup)', v: <Amount value={deal.terms.platformFee} /> } : null,
                hasTerms ? { k: 'Late fee (to charity)', v: <Amount value={deal.terms.lateFee} /> } : null,
              ]}
            />
          ) : null}
          {error ? <InlineError>{error}</InlineError> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant={hasTerms ? 'outline' : 'primary'} onClick={saveTerms} loading={saving} disabled={!costOk} data-testid="terms-save">
              {hasTerms ? 'Update terms' : 'Save terms'}
            </Button>
            <Button onClick={start} loading={starting} disabled={!uploaded || !hasTerms} icon={<Play className="size-4" />} data-testid="run-screening">
              Run screening
            </Button>
          </div>
          {!uploaded || !hasTerms ? <p className="text-xs text-ink-muted">Screening needs the three documents and the cost.</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}

function Verifying({ deal }: { deal: ImporterDealDetail }) {
  const refresh = useRefreshDeal();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 2), 2000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (seconds > 0 && seconds % 4 === 0) refresh(deal.id);
  }, [seconds, deal.id, refresh]);
  const stages = ['Reading the documents', 'Checking numbers and dates', 'Company registry and sanctions', 'Prices against the reference table', 'Deciding'];
  const idx = Math.min(stages.length - 1, Math.floor(seconds / 3));
  return (
    <Card data-testid="verifying">
      <CardHeader eyebrow="Step 4" title="Screening is running" />
      <CardBody>
        <ol className="space-y-2 text-sm">
          {stages.map((s, i) => (
            <li key={s} className={`flex items-center gap-2 ${i < idx ? 'text-success' : i === idx ? 'font-medium' : 'text-ink-faint'}`}>
              <span className={`size-2 rounded-full ${i < idx ? 'bg-success' : i === idx ? 'live-dot bg-indigo' : 'bg-line-strong'}`} aria-hidden />
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-ink-muted">Usually under a minute. This page updates by itself.</p>
      </CardBody>
    </Card>
  );
}

function Summary({ deal }: { deal: ImporterDealDetail }) {
  const t = deal.terms;
  const cost = BigInt(t.cost);
  return (
    <Card>
      <CardHeader eyebrow="Deal" title="Summary" />
      <CardBody>
        <KV
          dense
          rows={[
            { k: 'Supplier', v: deal.supplier.nameEn },
            deal.supplier.uscc ? { k: 'Company code', v: <span className="font-mono text-xs">{deal.supplier.uscc}</span> } : null,
            { k: 'Cost', v: cost > 0n ? <Amount value={t.cost} /> : 'not set' },
            cost > 0n ? { k: 'Markup', v: <span><Amount value={t.markup} /> ({bpsToPercent(Number((BigInt(t.markup) * 10000n) / cost))})</span> } : null,
            cost > 0n ? { k: 'Price you will owe', v: <Amount value={cost + BigInt(t.markup)} /> } : null,
            BigInt(deal.security) > 0n ? { k: 'Security deposit', v: <Amount value={deal.security} /> } : null,
            { k: 'Tenor', v: humanDuration(t.tenorSecs) },
            { k: 'Supplier deposit', v: `${bpsToPercent(t.depositBps)} before shipment` },
            t.fundingDeadline ? { k: 'Funding deadline', v: formatDateTime(t.fundingDeadline) } : null,
            { k: 'Created', v: formatDateTime(deal.createdAt) },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function TradeFile({ deal }: { deal: ImporterDealDetail }) {
  const on = useFlag('FF_TRADE_FILE');
  const q = useTradeFile(deal.id, on && Boolean(deal.state));
  if (!on || !deal.state) return null;
  if (q.isPending) return <SkeletonCard lines={2} />;
  if (q.isError) return null;
  return (
    <Card>
      <CardHeader eyebrow="For your bank" title="Trade file" />
      <CardBody className="space-y-2 text-sm">
        <p className="text-ink-muted">Documents, the signed report, your promise and every transaction link, in one bundle ({Math.round(q.data.bytes / 1024)} KB).</p>
        <ul className="list-disc pl-5 text-xs text-ink-muted">
          {q.data.contents.slice(0, 6).map((c) => (
            <li key={c}>{c}</li>
          ))}
          {q.data.contents.length > 6 ? <li>and {q.data.contents.length - 6} more</li> : null}
        </ul>
        <a href={q.data.url} download={q.data.filename} className="inline-flex items-center gap-1 text-indigo underline-offset-2 hover:underline">
          Download {q.data.filename}
        </a>
      </CardBody>
    </Card>
  );
}

/** Polls a screening job; used by the mock flow and the real API alike. */
export function useJob(jobId: string | null) {
  return useQuery({ queryKey: ['job', jobId], queryFn: () => apiGet(`/jobs/${jobId}`, JobStatusSchema), enabled: Boolean(jobId), refetchInterval: (q) => (q.state.data && ['done', 'failed', 'dead'].includes(q.state.data.status) ? false : 2000) });
}
