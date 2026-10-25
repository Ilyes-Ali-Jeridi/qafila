'use client';
/** O-1: queue of deals by status and decision, with the pending ops action first. Dense, keyboard-friendly table. */
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DecisionBadge } from '@/components/deal/badges';
import { StageBadge } from '@/components/importer/stage-badge';
import { OpsShell } from '@/components/ops/ops-shell';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/states';
import { describeError } from '@/lib/api/client';
import { useOpsQueue } from '@/lib/api/hooks';
import type { OpsQueueItem } from '@/lib/api/schemas';
import { timeAgo } from '@/lib/utils';

const ACTION_LABEL: Record<NonNullable<OpsQueueItem['pendingAction']>, string> = {
  review_report: 'Review the report',
  list: 'List the deal',
  pay_deposit: 'Pay the supplier deposit',
  confirm_shipment: 'Shipment check',
  release_bl: 'Release the B/L',
  mark_default: 'Mark default',
  finalize: 'Finalize recovery',
  extension: 'Extension request',
};

export function OpsQueue() {
  return (
    <OpsShell title="Queue" lead="Deals that need a person, first. Evidence is highlighted on each review page.">
      <Inner />
    </OpsShell>
  );
}

function Inner() {
  const q = useOpsQueue();
  const router = useRouter();
  const [filter, setFilter] = useState<'pending' | 'all' | 'draft' | 'running' | 'finished'>('pending');
  const [decision, setDecision] = useState<'any' | 'approve' | 'review' | 'reject'>('any');
  const items = useMemo(() => {
    const all = q.data ?? [];
    return all
      .filter((d) => (filter === 'pending' ? d.pendingAction !== null || d.openIncidents > 0 : filter === 'all' ? true : filter === 'draft' ? d.state === null : filter === 'running' ? ['Listed', 'Funded', 'DepositPaid', 'Owned', 'Sold', 'Defaulted'].includes(d.state ?? '') : ['Repaid', 'Cancelled', 'Liquidated', 'Closed'].includes(d.state ?? '')))
      .filter((d) => decision === 'any' || d.decision === decision)
      .sort((a, b) => Number(Boolean(b.pendingAction)) - Number(Boolean(a.pendingAction)) || b.updatedAt.localeCompare(a.updatedAt));
  }, [q.data, filter, decision]);

  if (q.isPending) return <SkeletonList count={4} />;
  if (q.isError) return <ErrorState title="Could not load the queue" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  const pendingCount = q.data.filter((d) => d.pendingAction).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-ink-muted">
          Show
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="mt-1 w-44">
            <option value="pending">Needs action ({pendingCount})</option>
            <option value="all">All deals ({q.data.length})</option>
            <option value="draft">Not listed</option>
            <option value="running">Running</option>
            <option value="finished">Finished</option>
          </Select>
        </label>
        <label className="flex flex-col text-xs text-ink-muted">
          Decision
          <Select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} className="mt-1 w-36">
            <option value="any">Any</option>
            <option value="approve">Approve</option>
            <option value="review">Review</option>
            <option value="reject">Reject</option>
          </Select>
        </label>
        <p className="tabular pb-2.5 font-mono text-xs text-ink-muted">{items.length} shown</p>
      </div>
      {items.length === 0 ? (
        <EmptyState title={filter === 'pending' ? 'Nothing needs a person right now' : 'No deals here'} body={filter === 'pending' ? 'New deals appear as importers run screening.' : undefined} />
      ) : (
        <Card className="glass-strong overflow-hidden">
          <div className="max-h-[70vh] overflow-auto">
            <table className="data-table text-sm" data-testid="ops-queue">
              <thead>
                <tr>
                  <th scope="col">Deal</th>
                  <th scope="col">Goods and parties</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Decision</th>
                  <th scope="col" className="text-right">Cost</th>
                  <th scope="col">Next action</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr
                    key={d.id}
                    data-testid={`ops-deal-${d.number}`}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open deal ${d.number}`}
                    onClick={() => router.push(`/ops/deals/${d.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/ops/deals/${d.id}`);
                      }
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:[&>td]:bg-teal-100"
                  >
                    <td className="tabular whitespace-nowrap font-mono text-xs text-ink-muted">#{d.number}</td>
                    <td className="min-w-[16rem]">
                      <p className="font-medium leading-snug">{d.goodsSummary}</p>
                      <p className="text-xs text-ink-muted">
                        {d.importerName} · {d.supplierName} · {d.route.originPort} to {d.route.destinationPort}
                      </p>
                      {d.openIncidents ? (
                        <Badge tone="danger" className="mt-1">
                          {d.openIncidents} incident{d.openIncidents === 1 ? '' : 's'}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap">
                      <StageBadge stage={d.stage} />
                    </td>
                    <td className="whitespace-nowrap">
                      <DecisionBadge decision={d.decision} riskScore={d.riskScore} />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Amount value={d.cost} size="sm" />
                    </td>
                    <td className="whitespace-nowrap">{d.pendingAction ? <span className="rounded-full bg-saffron-100 px-2.5 py-1 text-xs font-medium text-saffron-700 ring-1 ring-inset ring-saffron/25">{ACTION_LABEL[d.pendingAction]}</span> : <span className="text-xs text-ink-faint">waiting</span>}</td>
                    <td className="tabular whitespace-nowrap font-mono text-xs text-ink-muted">{timeAgo(d.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
