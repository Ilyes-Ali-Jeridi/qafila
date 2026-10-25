import type { DealStateName, Decision } from '@qafila/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';

/** Plain words for contract states (PLAN 9.1 copy rules). */
export const STATE_LABEL: Record<DealStateName, string> = {
  Listed: 'Open for funding',
  Funded: 'Funded',
  DepositPaid: 'Supplier paid, awaiting shipment',
  Owned: 'Goods owned, awaiting sale',
  Sold: 'Sold, repayment running',
  Repaid: 'Repaid',
  Cancelled: 'Cancelled, refunds open',
  Defaulted: 'In default, recovery running',
  Liquidated: 'Wound up, claims open',
  Closed: 'Closed',
};

const STATE_TONE: Record<DealStateName, BadgeTone> = {
  Listed: 'teal',
  Funded: 'indigo',
  DepositPaid: 'indigo',
  Owned: 'indigo',
  Sold: 'indigo',
  Repaid: 'success',
  Cancelled: 'neutral',
  Defaulted: 'danger',
  Liquidated: 'warning',
  Closed: 'neutral',
};

export function StateBadge({ state, fallback }: { state: DealStateName | null; fallback?: string }) {
  if (!state) return <Badge tone="neutral">{fallback ?? 'Not listed'}</Badge>;
  return (
    <Badge tone={STATE_TONE[state]} dot={state === 'Listed'}>
      {STATE_LABEL[state]}
    </Badge>
  );
}

export function DecisionBadge({ decision, riskScore }: { decision: Decision | null; riskScore: number | null }) {
  if (!decision) return <Badge tone="neutral">Not screened</Badge>;
  const tone: BadgeTone = decision === 'approve' ? 'success' : decision === 'review' ? 'warning' : 'danger';
  const label = decision === 'approve' ? 'AI approved' : decision === 'review' ? 'Needs review' : 'Rejected';
  return (
    <Badge tone={tone}>
      {label}
      {riskScore !== null ? <span className="tabular opacity-80">· {riskScore}/100</span> : null}
    </Badge>
  );
}
