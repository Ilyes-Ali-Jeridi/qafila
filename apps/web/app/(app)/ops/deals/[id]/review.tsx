'use client';
/** O-1 to O-6: report review with documents side by side and evidence highlighted, then the actions. */
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DecisionBadge } from '@/components/deal/badges';
import { CheckIcon, checkLabel } from '@/components/deal/checks-list';
import { OnchainTimeline } from '@/components/deal/onchain-timeline';
import { PaymentsList } from '@/components/deal/payments-list';
import { TrackingEvents } from '@/components/deal/tracking-events';
import { DOC_LABEL } from '@/components/importer/document-upload';
import { StageBadge } from '@/components/importer/stage-badge';
import { OpsActions } from '@/components/ops/actions';
import { OpsShell } from '@/components/ops/ops-shell';
import { Address } from '@/components/ui/address';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KV } from '@/components/ui/kv';
import { EmptyState, ErrorState, SkeletonCard, SkeletonList } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { Timeline } from '@/components/ui/timeline';
import { TxLink } from '@/components/ui/tx-link';
import { describeError } from '@/lib/api/client';
import { useOpsDeal, useReport } from '@/lib/api/hooks';
import type { OpsDealDetail } from '@/lib/api/schemas';
import { bpsToPercent, type DocumentType } from '@qafila/shared';
import { formatDateTime, humanDuration } from '@/lib/utils';

export function OpsReview({ id }: { id: string }) {
  const q = useOpsDeal(id);
  return (
    <OpsShell title={q.data ? `Deal ${q.data.number}` : 'Deal'} lead={q.data?.goodsSummary}>
      {q.isPending ? <SkeletonList count={3} /> : q.isError ? <ErrorState title="Could not load the deal" body={describeError(q.error)} onRetry={() => void q.refetch()} /> : <Inner deal={q.data} />}
    </OpsShell>
  );
}

function Inner({ deal }: { deal: OpsDealDetail }) {
  const [tab, setTab] = useState<'review' | 'chain' | 'log'>('review');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StageBadge stage={deal.stage} />
        <DecisionBadge decision={deal.decision} riskScore={deal.riskScore} />
        {deal.state ? (
          <Link href={`/deals/${deal.id}`} className="inline-flex items-center gap-1 text-sm text-indigo hover:underline">
            Public page <ExternalLink className="size-3.5" />
          </Link>
        ) : null}
        <span className="text-sm text-ink-muted">· {deal.nextAction}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: 'review', label: 'Documents and checks' },
              { key: 'chain', label: 'On-chain', count: deal.timeline.length },
              { key: 'log', label: 'Audit and agent', count: deal.audit.length + deal.agentActions.length + deal.incidents.length },
            ]}
          />
          {tab === 'review' ? <ReviewTab deal={deal} /> : tab === 'chain' ? <ChainTab deal={deal} /> : <LogTab deal={deal} />}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <OpsActions deal={deal} />
          <Parties deal={deal} />
        </aside>
      </div>
    </div>
  );
}

function ReviewTab({ deal }: { deal: OpsDealDetail }) {
  const report = useReport(deal.id, Boolean(deal.reportSummary));
  const docs = deal.documents.filter((d) => d.status === 'uploaded');
  const [open, setOpen] = useState<DocumentType | null>(docs[0]?.type ?? null);
  const highlighted = report.data ? new Set(report.data.report.checks.filter((c) => c.status !== 'pass' && c.status !== 'skipped').map((c) => c.document)) : new Set<string | undefined>();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader eyebrow={`${docs.length} documents`} title="Documents" />
        <CardBody>
          {docs.length === 0 ? (
            <EmptyState title="No documents uploaded yet" />
          ) : (
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <ul className="space-y-1">
                {docs.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => setOpen(d.type)} className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${open === d.type ? 'border-teal/50 bg-teal-100' : 'border-line hover:bg-white/[0.05]'}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{DOC_LABEL[d.type]}</span>
                        {highlighted.has(d.type) ? <Badge tone="warning">flagged</Badge> : null}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {d.filename} · {d.pages ?? '?'} p · {d.sha256.slice(0, 10)}…
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="min-h-64 overflow-hidden rounded-md border border-line bg-page/60">
                <DocumentViewer doc={docs.find((x) => x.type === open)} />
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {deal.reportSummary ? (
        report.isPending ? (
          <SkeletonCard lines={8} />
        ) : report.isError ? (
          <ErrorState title="Could not load the report" body={describeError(report.error)} onRetry={() => void report.refetch()} />
        ) : (
          <Card>
            <CardHeader eyebrow={`${report.data.stage} screening, ${formatDateTime(report.data.createdAt)}`} title="Checks and evidence" action={<DecisionBadge decision={report.data.decision} riskScore={report.data.riskScore} />} />
            <CardBody className="space-y-3">
              {report.data.explanation ? <p className="rounded-md bg-surface-2 p-3 text-sm">{report.data.explanation}</p> : null}
              <ul className="divide-y divide-line">
                {[...report.data.report.checks]
                  .sort((a, b) => Number(a.status === 'pass') - Number(b.status === 'pass'))
                  .map((c) => (
                    <li key={c.name} className={`flex gap-3 py-2.5 ${c.status !== 'pass' && c.status !== 'skipped' ? '-mx-2 rounded-md bg-warning-100 px-2' : ''}`}>
                      <span className="mt-0.5 shrink-0"><CheckIcon status={c.status} /></span>
                      <div className="min-w-0 text-sm">
                        <p className="font-medium">
                          {checkLabel(c.name)} <span className="font-normal text-ink-faint">· {c.severity} · weight {c.weight}</span>
                        </p>
                        <p className="text-ink-muted">{c.detail}</p>
                        {c.document ? (
                          <p className="text-xs text-ink-muted">
                            {DOC_LABEL[c.document as DocumentType] ?? c.document}
                            {c.field ? ` · ${c.field}` : ''}
                          </p>
                        ) : null}
                        {c.fix ? <p className="mt-1 text-xs">Fix: {c.fix}</p> : null}
                        {c.evidence !== undefined ? <pre className="mt-1 max-h-32 overflow-auto rounded bg-sand-100 p-2 text-[11px]">{typeof c.evidence === 'string' ? c.evidence : JSON.stringify(c.evidence, null, 1)}</pre> : null}
                      </div>
                    </li>
                  ))}
              </ul>
              <details className="text-sm">
                <summary className="cursor-pointer text-indigo">Registry, sanctions, prices, halal, consistency</summary>
                <div className="mt-2 space-y-3">
                  {report.data.report.registry ? (
                    <KV dense rows={[{ k: 'Registry', v: `${report.data.report.registry.source} (${report.data.report.registry.mode})` }, { k: 'Found', v: report.data.report.registry.found ? 'yes' : 'no' }, { k: 'Entity status', v: report.data.report.registry.entity_status ?? 'unknown' }, { k: 'LEI status', v: report.data.report.registry.lei_status ?? 'unknown' }, { k: 'Chinese name match', v: report.data.report.registry.name_match_zh }, { k: 'English name match', v: report.data.report.registry.name_match_en }, report.data.report.registry.manual_check_url ? { k: 'Manual check', v: <a className="text-indigo hover:underline" href={report.data.report.registry.manual_check_url} target="_blank" rel="noreferrer">gsxt.gov.cn</a> } : null]} />
                  ) : null}
                  <p>Sanctions hits: {report.data.report.sanctions.length === 0 ? 'none' : report.data.report.sanctions.map((h) => `${h.party} ${h.score.toFixed(2)}`).join(', ')}</p>
                  <ul className="list-disc pl-5">
                    {report.data.report.price.map((p) => (
                      <li key={p.line}>
                        {p.line}: {p.category ?? 'no category'}, ratio {p.ratio_to_mid ?? '?'} ({p.status})
                      </li>
                    ))}
                    {report.data.report.halal.map((h) => (
                      <li key={`h-${h.line}`}>
                        Halal: {h.line} is {h.verdict} ({h.category}): {h.reason}
                      </li>
                    ))}
                    {report.data.report.consistency.map((c) => (
                      <li key={c.field}>
                        {c.field}: {c.match} ({c.reason})
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-ink-muted">
                    Models: {report.data.report.models.map((m) => `${m.model_id} (${m.prompt_version})`).join(', ') || 'none'} · cost ${report.data.report.cost_usd.toFixed(3)} · hash {report.data.reportHash.slice(0, 16)}… {report.data.signature ? '· signed' : '· unsigned'}
                  </p>
                </div>
              </details>
            </CardBody>
          </Card>
        )
      ) : (
        <EmptyState title="Not screened yet" body="The importer has not run screening." />
      )}
    </div>
  );
}

function DocumentViewer({ doc }: { doc: OpsDealDetail['documents'][number] | undefined }) {
  if (!doc?.viewUrl) return <p className="p-4 text-sm text-ink-muted">Pick a document.</p>;
  if (doc.mime === 'application/pdf') return <iframe src={doc.viewUrl} title={doc.filename} className="h-[520px] w-full" />;
  // Private, signed URL from the API; next/image cannot optimise it.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={doc.viewUrl} alt={doc.filename} loading="lazy" decoding="async" className="max-h-[520px] w-full object-contain" />;
}

function ChainTab({ deal }: { deal: OpsDealDetail }) {
  return (
    <div className="space-y-4">
      {deal.listing ? (
        <Card>
          <CardHeader eyebrow="Share token" title="Factory and listing transactions" />
          <CardBody>
            <KV
              dense
              rows={[
                deal.listing.shareToken ? { k: 'Share token', v: <Address value={deal.listing.shareToken} /> } : null,
                deal.listing.issuerPublicKey ? { k: 'Issuer (locked)', v: <Address value={deal.listing.issuerPublicKey} /> } : null,
                ...Object.entries(deal.listing.txHashes).map(([k, v]) => ({ k: k.replaceAll('_', ' '), v: <TxLink hash={v} short /> })),
              ]}
            />
          </CardBody>
        </Card>
      ) : null}
      {deal.tracking ? <TrackingEvents tracking={deal.tracking} /> : null}
      <PaymentsList payments={deal.payments} />
      <OnchainTimeline timeline={deal.timeline} />
    </div>
  );
}

function LogTab({ deal }: { deal: OpsDealDetail }) {
  const items = [
    ...deal.audit.map((a) => ({ key: `a-${a.id}`, title: `${a.action} by ${a.actor.length > 20 ? `${a.actor.slice(0, 6)}…` : a.actor}`, body: a.reason ?? undefined, when: formatDateTime(a.at), tone: 'default' as const, action: a.txHash ? <TxLink hash={a.txHash} short /> : undefined })),
    ...deal.agentActions.map((a) => ({ key: `g-${a.id}`, title: `Agent: ${a.action} (${a.decision})`, body: a.reasoning, when: formatDateTime(a.at), tone: a.status === 'failed' ? ('danger' as const) : ('success' as const), action: a.txHash ? <TxLink hash={a.txHash} short /> : undefined })),
    ...deal.incidents.map((i) => ({ key: `i-${i.id}`, title: `Incident: ${i.kind} (${i.status})`, body: i.detail, when: formatDateTime(i.at), tone: i.status === 'open' ? ('danger' as const) : ('default' as const) })),
    ...deal.recoveries.map((r, n) => ({ key: `r-${n}`, title: 'Recovery', body: r.note, when: formatDateTime(r.at), tone: 'saffron' as const, action: <span className="flex items-center gap-2"><Amount value={r.amount} size="sm" />{r.txHash ? <TxLink hash={r.txHash} short /> : null}</span> })),
    ...deal.recoveryNotes.map((r, n) => ({ key: `n-${n}`, title: `Recovery note by ${r.by.slice(0, 6)}…`, body: r.note, when: formatDateTime(r.at), tone: 'default' as const })),
  ].sort((a, b) => b.when.localeCompare(a.when));
  return (
    <div className="space-y-4">
      {deal.abort ? (
        <Card>
          <CardHeader eyebrow="Aborted" title={`${deal.abort.reason.replaceAll('_', ' ')} · importer at fault: ${deal.abort.importerAtFault ? 'yes' : 'no'}`} />
          <CardBody className="text-sm">
            <p>{deal.abort.note}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {formatDateTime(deal.abort.at)} {deal.abort.txHash ? <TxLink hash={deal.abort.txHash} short /> : null}
            </p>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader eyebrow={`${items.length} entries`} title="Audit log, agent actions, incidents" />
        <CardBody>{items.length ? <Timeline items={items} /> : <EmptyState title="Nothing logged yet" />}</CardBody>
      </Card>
    </div>
  );
}

function Parties({ deal }: { deal: OpsDealDetail }) {
  return (
    <Card>
      <CardHeader eyebrow="Parties and terms" title="Importer and supplier" />
      <CardBody>
        <KV
          dense
          rows={[
            { k: 'Importer', v: deal.importer.legalName },
            { k: 'KYB', v: deal.importer.kybStatus },
            deal.importer.walletAddress ? { k: 'Wallet', v: <Address value={deal.importer.walletAddress} /> } : null,
            { k: 'History', v: `${deal.importer.stats.on_time} on time, ${deal.importer.stats.late} late, ${deal.importer.stats.defaulted} default` },
            { k: 'Limit', v: <Amount value={deal.importer.limit} /> },
            { k: 'Supplier', v: deal.supplier.nameEn },
            deal.supplier.uscc ? { k: 'USCC', v: <span className="font-mono text-xs">{deal.supplier.uscc}</span> } : null,
            deal.supplier.payoutAddress ? { k: 'Payout address', v: <Address value={deal.supplier.payoutAddress} /> } : { k: 'Payout address', v: <span className="text-warning">missing</span> },
            { k: 'Supplier confirmed PO', v: deal.supplier.confirmed ? 'yes' : 'no' },
            { k: 'Cost', v: <Amount value={deal.terms.cost} /> },
            { k: 'Markup', v: <Amount value={deal.terms.markup} /> },
            { k: 'Security deposit', v: <span><Amount value={deal.security} /> {BigInt(deal.terms.cost) > 0n ? `(${bpsToPercent(Number((BigInt(deal.security) * 10000n) / BigInt(deal.terms.cost)))})` : ''}</span> },
            { k: 'Supplier deposit', v: bpsToPercent(deal.terms.depositBps) },
            { k: 'Tenor', v: humanDuration(deal.terms.tenorSecs) },
            deal.promise?.txHash ? { k: 'Promise', v: <TxLink hash={deal.promise.txHash} short /> } : { k: 'Promise', v: 'not signed' },
          ]}
        />
      </CardBody>
    </Card>
  );
}
