import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { ImporterStage } from '@/lib/api/schemas';

export const STAGE_LABEL: Record<ImporterStage, string> = {
  draft: 'Draft',
  verifying: 'Screening',
  review: 'Needs a fix',
  rejected: 'Rejected',
  approved: 'Approved, promise to sign',
  promised: 'Promise signed, waiting for listing',
  listed: 'Open for funding',
  funded: 'Funded',
  deposit_paid: 'Supplier paid, ship the goods',
  owned: 'Goods owned, sign the sale',
  sold: 'Sold, repayment running',
  repaid: 'Repaid',
  closed: 'Closed',
  cancelled: 'Cancelled',
  defaulted: 'In default',
  liquidated: 'Wound up',
};

const TONE: Record<ImporterStage, BadgeTone> = {
  draft: 'neutral',
  verifying: 'indigo',
  review: 'warning',
  rejected: 'danger',
  approved: 'success',
  promised: 'indigo',
  listed: 'saffron',
  funded: 'indigo',
  deposit_paid: 'indigo',
  owned: 'saffron',
  sold: 'indigo',
  repaid: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
  defaulted: 'danger',
  liquidated: 'warning',
};

export function StageBadge({ stage }: { stage: ImporterStage }) {
  return (
    <Badge tone={TONE[stage]} dot={stage === 'verifying'}>
      {STAGE_LABEL[stage]}
    </Badge>
  );
}
