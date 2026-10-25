'use client';
import { PackageSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DealSummary } from '@qafila/shared';
import { DealCard } from '@/components/deal/deal-card';
import { Reveal } from '@/components/motion/reveal';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/states';
import { ButtonLink } from '@/components/ui/button';
import { describeError } from '@/lib/api/client';
import { useDeals } from '@/lib/api/hooks';
import { cn } from '@/lib/utils';

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

function Pills<K extends string>({ label, value, onChange, options }: { label: string; value: K; onChange: (k: K) => void; options: Array<[K, string]> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="eyebrow mr-1">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map(([k, text]) => {
          const on = k === value;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(k)}
              className={cn(
                'h-8 rounded-full border px-3 text-xs font-medium transition-[background-color,border-color,color,box-shadow] duration-200',
                on ? 'border-teal/50 bg-teal-100 text-teal shadow-[0_0_16px_-6px_rgba(45,226,195,0.8)]' : 'border-line bg-white/[0.03] text-ink-muted hover:border-white/25 hover:text-ink',
              )}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
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
      <Reveal>
        <PageHeader eyebrow="Marketplace" title="Shipments to fund" lead="Each deal buys real goods for a named importer and sells them on at a price fixed from day one. You fund the purchase and share the fixed profit." />
      </Reveal>
      <Reveal delay={0.08} className="glass flex flex-col gap-3 rounded-card p-3 sm:p-4">
        <Pills
          label="Status"
          value={stage}
          onChange={setStage}
          options={[
            ['all', 'All deals'],
            ['open', q.data ? `Open for funding (${openCount})` : 'Open for funding'],
            ['running', 'Running'],
            ['finished', 'Finished'],
          ]}
        />
        <Pills
          label="Tenor"
          value={tenor}
          onChange={setTenor}
          options={[
            ['any', 'Any tenor'],
            ['short', 'Up to 60 days'],
            ['mid', '61 to 90 days'],
            ['long', 'Over 90 days'],
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Pills
            label="Risk score"
            value={risk}
            onChange={setRisk}
            options={[
              ['any', 'Any score'],
              ['high', '90 and above'],
              ['mid', '70 to 89'],
              ['low', 'Below 70'],
            ]}
          />
          {q.data ? (
            <p className="tabular font-mono text-xs text-ink-muted" aria-live="polite">
              {deals.length} of {q.data.length} deals
            </p>
          ) : null}
        </div>
      </Reveal>

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
