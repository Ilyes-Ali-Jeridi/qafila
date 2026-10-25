'use client';
import { Progress } from '@/components/ui/progress';
import { Amount } from '@/components/ui/amount';
import { percentOf } from '@/lib/utils';

export function FundingProgress({ funded, cost, compact }: { funded: string; cost: string; compact?: boolean }) {
  const pct = percentOf(funded, cost);
  const left = BigInt(cost) - BigInt(funded);
  return (
    <div className="space-y-1.5">
      <Progress value={pct} label="Funding progress" tone={pct >= 100 ? 'success' : 'indigo'} />
      <div className="flex items-baseline justify-between gap-2 text-xs text-ink-muted">
        <span>
          <Amount value={funded} size="sm" className="font-medium text-ink" /> of <Amount value={cost} size="sm" />
        </span>
        {!compact ? <span className="tabular">{left > 0n ? `${pct.toFixed(0)}% funded` : 'Fully funded'}</span> : <span className="tabular">{pct.toFixed(0)}%</span>}
      </div>
    </div>
  );
}
