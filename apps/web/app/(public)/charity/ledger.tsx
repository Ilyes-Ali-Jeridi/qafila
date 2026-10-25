'use client';
/** Charity ledger (PLAN 9.2): every late fee and dust transfer with transaction links and totals. */
import { HandHeart } from 'lucide-react';
import Link from 'next/link';
import { Address } from '@/components/ui/address';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Stat } from '@/components/ui/stat';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { describeError } from '@/lib/api/client';
import { useCharity } from '@/lib/api/hooks';
import { formatDateTime } from '@/lib/utils';

const KIND: Record<string, string> = { late_fee: 'Late fee', dust: 'Rounding dust', sweep: 'Sweep' };

export function CharityLedger() {
  const q = useCharity();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Public ledger" title="Charity ledger" lead="Late fees and rounding dust never go to investors or to Qafila. The contract sets them aside and the agent sweeps them to the charity address. Every transfer is here." />
      {q.isPending ? (
        <SkeletonList count={3} />
      ) : q.isError ? (
        <ErrorState title="Could not load the ledger" body={describeError(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Sent to charity" value={<Amount value={q.data.total} />} />
            <Stat label="Set aside, not yet swept" value={<Amount value={q.data.owed} />} hint="the agent sweeps after every late fee" />
            <Card className="p-4">
              <p className="eyebrow">Charity address</p>
              <div className="mt-1.5">{q.data.address ? <Address value={q.data.address} head={6} tail={6} /> : <span className="text-sm text-ink-muted">not set</span>}</div>
            </Card>
          </div>
          {q.data.entries.length === 0 ? (
            <EmptyState icon={<HandHeart className="size-5" />} title="Nothing sent yet" body="The first entry appears when an importer pays a late fee or a deal closes with rounding dust." />
          ) : (
            <Card>
              <CardBody className="p-0">
                <ul className="divide-y divide-line" data-testid="charity-entries">
                  {q.data.entries.map((e) => (
                    <li key={e.txHash} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={e.kind === 'late_fee' ? 'saffron' : 'neutral'}>{KIND[e.kind] ?? e.kind}</Badge>
                        {e.dealNumber !== null ? (
                          <Link href={`/deals/${e.dealNumber}`} className="text-indigo hover:underline">
                            Deal {e.dealNumber}
                          </Link>
                        ) : null}
                        <span className="text-xs text-ink-muted">{formatDateTime(e.at)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Amount value={e.amount} className="font-medium" />
                        <TxLink hash={e.txHash} short />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
