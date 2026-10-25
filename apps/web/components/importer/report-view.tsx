'use client';
/** FLOWS I-3 and I-4: the screening result in plain words with exactly what to fix; reject category. */
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { DecisionBadge } from '@/components/deal/badges';
import { CheckIcon, checkLabel } from '@/components/deal/checks-list';
import { Button } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState, InlineError, SkeletonCard } from '@/components/ui/states';
import { apiPost, describeError } from '@/lib/api/client';
import { useReport, useRefreshDeal } from '@/lib/api/hooks';
import { VerifyResponseSchema, type ImporterDealDetail } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/utils';
import { DocumentUpload, DOC_LABEL } from './document-upload';
import type { DocumentType } from '@qafila/shared';

const CATEGORY: Record<string, string> = {
  identity: 'Identity: the supplier or the company could not be verified.',
  sanctions: 'Sanctions: a party matched a sanctions list. The account is under review.',
  duplicate: 'Duplicate: these documents were already financed. The account is under review.',
  prohibited_goods: 'Prohibited goods: a line item is not allowed under the halal policy.',
  document_integrity: 'Document integrity: a number or a check digit on a document is wrong.',
};

export function ReportView({ deal }: { deal: ImporterDealDetail }) {
  const q = useReport(deal.id, Boolean(deal.reportSummary));
  const refresh = useRefreshDeal();
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  if (q.isPending) return <SkeletonCard lines={6} />;
  if (q.isError) return <ErrorState title="Could not load the report" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const failing = r.report.checks.filter((c) => c.status !== 'pass' && c.status !== 'skipped');
  const docTypes = Array.from(new Set(r.fixes.map((f) => f.document).filter((d): d is string => Boolean(d)))) as DocumentType[];

  async function rerun() {
    setError(null);
    setRerunning(true);
    try {
      await apiPost(`/deals/${deal.id}/verify`, {}, VerifyResponseSchema);
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRerunning(false);
    }
  }

  return (
    <Card data-testid="report-view">
      <CardHeader eyebrow={`Screening, ${formatDateTime(r.createdAt)}`} title={r.decision === 'approve' ? 'Approved by screening' : r.decision === 'review' ? 'One thing to fix' : 'This deal cannot go ahead'} action={<DecisionBadge decision={r.decision} riskScore={r.riskScore} />} />
      <CardBody className="space-y-4">
        {r.explanation ? <p className="text-sm leading-relaxed">{r.explanation}</p> : null}
        {r.decision === 'reject' ? (
          <Callout tone="danger" title={CATEGORY[r.rejectCategory ?? ''] ?? 'Rejected'}>
            <p>The same files cannot be submitted again. Start a new request with corrected documents if the problem can be fixed.</p>
          </Callout>
        ) : null}
        {r.fixes.length ? (
          <div className="space-y-2">
            <p className="eyebrow">What to fix</p>
            <ul className="space-y-2">
              {r.fixes.map((f) => (
                <li key={f.check} className="rounded-md border border-warning/30 bg-warning-100 p-3 text-sm">
                  <p className="font-medium">
                    {checkLabel(f.check)}
                    {f.document ? <span className="font-normal text-ink-muted"> · {DOC_LABEL[f.document as DocumentType] ?? f.document}{f.field ? ` · ${f.field.replaceAll('_', ' ')}` : ''}</span> : null}
                  </p>
                  <p className="mt-1">{f.fix}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {r.decision === 'review' && docTypes.length ? (
          <div className="space-y-2">
            <p className="eyebrow">Re-upload and run screening again</p>
            {docTypes.map((t) => (
              <DocumentUpload key={t} dealId={deal.id} type={t} existing={deal.documents.find((d) => d.type === t)} onUploaded={() => refresh(deal.id)} />
            ))}
            {error ? <InlineError>{error}</InlineError> : null}
            <Button onClick={rerun} loading={rerunning} icon={<RefreshCw className="size-4" />} data-testid="rerun-screening">
              Run screening again
            </Button>
          </div>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer text-indigo">All {r.report.checks.length} checks ({failing.length} not passed)</summary>
          <ul className="mt-2 divide-y divide-line">
            {r.report.checks.map((c) => (
              <li key={c.name} className="flex gap-3 py-2">
                <span className="mt-0.5 shrink-0"><CheckIcon status={c.status} /></span>
                <div>
                  <p className="font-medium">{checkLabel(c.name)}</p>
                  <p className="text-ink-muted">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            Report hash <code className="font-mono">{r.reportHash.slice(0, 16)}…</code>
            {r.signature ? ' · signed by the verifier' : ''}
            {Object.values(r.report.adapter_modes).includes('mock') ? ' · some checks used recorded data' : ''}
          </p>
        </details>
      </CardBody>
    </Card>
  );
}
