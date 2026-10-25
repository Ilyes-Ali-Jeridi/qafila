import { Check, CircleAlert, CircleHelp, Minus, X } from 'lucide-react';
import type { DealDetail } from '@qafila/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DecisionBadge } from './badges';
import { formatDateTime } from '@/lib/utils';

const LABELS: Record<string, string> = {
  company_code_check_digit: 'Supplier company code',
  container_check_digit: 'Container numbers',
  invoice_arithmetic: 'Invoice arithmetic',
  dates: 'Dates',
  weights: 'Weights',
  quantities: 'Quantities',
  incoterms_hs_codes: 'Incoterms and HS codes',
  supplier_equals_shipper: 'Supplier is the shipper',
  buyer_is_deal_entity: 'Buyer is the deal entity',
  goods_descriptions_match: 'Goods descriptions match',
  halal_screen: 'Halal screen',
  price_reference: 'Price against reference',
  registry: 'Company registry',
  sanctions: 'Sanctions lists',
  fingerprint_unique: 'Not financed before',
  key_field_confidence: 'Document readability',
  consignee_to_order: 'Bill of lading to the order of the deal entity',
  vessel_matches_tracking: 'Vessel matches carrier tracking',
};

export function checkLabel(name: string) {
  return LABELS[name] ?? name.replaceAll('_', ' ');
}

export function CheckIcon({ status }: { status: string }) {
  if (status === 'pass') return <Check className="size-4 text-success" aria-label="pass" />;
  if (status === 'fail') return <X className="size-4 text-danger" aria-label="fail" />;
  if (status === 'review') return <CircleAlert className="size-4 text-warning" aria-label="needs review" />;
  if (status === 'unavailable') return <CircleHelp className="size-4 text-ink-faint" aria-label="unavailable" />;
  return <Minus className="size-4 text-ink-faint" aria-label="skipped" />;
}

/** AI decision, risk score and the list of checks (investors never see raw documents). */
export function ChecksList({ report }: { report: NonNullable<DealDetail['publicReport']> }) {
  const mocks = Object.entries(report.adapterModes).filter(([, m]) => m === 'mock').map(([k]) => k);
  return (
    <Card>
      <CardHeader eyebrow={`${report.stage === 'listing' ? 'Listing' : 'Shipment'} screening, ${formatDateTime(report.createdAt)}`} title="AI verification" action={<DecisionBadge decision={report.decision} riskScore={report.riskScore} />} />
      <CardBody>
        <ul className="divide-y divide-line">
          {report.checks.map((c) => (
            <li key={c.name} className="flex gap-3 py-2.5">
              <span className="mt-0.5 shrink-0">
                <CheckIcon status={c.status} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{checkLabel(c.name)}</p>
                <p className="text-sm text-ink-muted">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span>Report hash</span>
          <code className="rounded bg-sand-100 px-1.5 py-0.5 font-mono">{report.reportHash.slice(0, 16)}…</code>
          {report.signature ? <Badge tone="indigo">Signed by the verifier</Badge> : <Badge tone="neutral">Unsigned</Badge>}
          {mocks.length ? <Badge tone="warning">Recorded data: {mocks.join(', ')}</Badge> : null}
        </div>
      </CardBody>
    </Card>
  );
}
