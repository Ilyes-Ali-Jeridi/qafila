'use client';
import { PackageSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DealSummary } from '@qafila/shared';
import { DealCard } from '@/components/deal/deal-card';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { describeError } from '@/lib/api/client';
import { useDeals } from '@/lib/api/hooks';

type Tenor = 'any' | 'short' | 'mid' | 'long';
type Risk = 'any' | 'high' | 'mid' | 'low';
type Stage = 'open' | 'all' | 'running' | 'finished';

const DAY = 86_400;

function tenorOk(d: DealSummary, t: Tenor) {
  if (t === 'any') return true;
  const days = d.tenorSecs / DAY;
  return t === 'short' ? days <= 60 : t === 'mid' ? days > 60 && days <= 90 : days > 90;
}
function riskOk(d: DealSummary, r: Risk) {
  if (r === 'any') return true;
  const s = d.riskScore ?? -1;
  return r === 'high' ? s >= 90 : r === 'mid' ? s >= 70 && s < 90 : s >= 0 && s < 70;
}
function stageOk(d: DealSummary, s: Stage) {
  if (s === 'all') return true;
  if (s === 'open') return d.state === 'Listed';
  if (s === 'running') return ['Funded', 'DepositPaid', 'Owned', 'Sold'].includes(d.state ?? '');
  return ['Repaid', 'Cancelled', 'Defaulted', 'Liquidated', 'Closed'].includes(d.state ?? '');
}

/** Marketplace (FLOWS V-2): compare deals by goods, route, return, tenor, risk, importer history and deposit; filter by tenor and risk. */
export function Marketplace() {
  const q = useDeals();
  const [tenor, setTenor] = useState<Tenor>('any');
  const [risk, setRisk] = useState<Risk>('any');
  const [stage, setStage] = useState<Stage>('all');
  const deals = useMemo(() => (q.data ?? []).filter((d) => tenorOk(d, tenor) && riskOk(d, risk) && stageOk(d, stage)), [q.data, tenor, risk, stage]);
  const openCount = (q.data ?? []).filter((d) => d.state === 'Listed').length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Marketplace" title="Shipments to fund" lead="Each deal buys real goods for a named importer and sells them on at a price fixed from day one. You fund the purchase and share the fixed profit." />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-muted">
          Status
          <Select value={stage} onChange={(e) => setStage(e.target.value as Stage)} className="mt-1 w-44" aria-label="Filter by status">
            <option value="all">All deals</option>
            <option value="open">Open for funding{q.data ? ` (${openCount})` : ''}</option>
            <option value="running">Running</option>
            <option value="finished">Finished</option>
          </Select>
        </label>
        <label className="text-xs text-ink-muted">
          Tenor
          <Select value={tenor} onChange={(e) => setTenor(e.target.value as Tenor)} className="mt-1 w-40" aria-label="Filter by tenor">
            <option value="any">Any tenor</option>
            <option value="short">Up to 60 days</option>
            <option value="mid">61 to 90 days</option>
            <option value="long">Over 90 days</option>
          </Select>
        </label>
        <label className="text-xs text-ink-muted">
          Risk score
          <Select value={risk} onChange={(e) => setRisk(e.target.value as Risk)} className="mt-1 w-40" aria-label="Filter by risk score">
            <option value="any">Any score</option>
            <option value="high">90 and above</option>
            <option value="mid">70 to 89</option>
            <option value="low">Below 70</option>
          </Select>
        </label>
        {q.data ? <p className="pb-2.5 text-xs text-ink-muted tabular">{deals.length} of {q.data.length} deals</p> : null}
      </div>

      {q.isPending ? (
        <SkeletonList count={6} lines={4} />
      ) : q.isError ? (
        <ErrorState title="Could not load the deals" body={describeError(q.error)} onRetry={() => void q.refetch()} />
      ) : deals.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="size-5" />}
          title={q.data.length === 0 ? 'No deals listed yet' : 'No deals match these filters'}
          body={q.data.length === 0 ? 'Deals appear here once ops lists them. Importers can start a request now.' : 'Try a wider tenor or risk range.'}
          action={q.data.length === 0 ? <ButtonLink href="/importer/new" variant="outline">I am an importer</ButtonLink> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="deal-grid">
          {deals.map((d, i) => (
            <DealCard key={d.id} deal={d} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
