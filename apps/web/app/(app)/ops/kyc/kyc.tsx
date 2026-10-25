'use client';
import { useState } from 'react';
import { OpsShell } from '@/components/ops/ops-shell';
import { Address } from '@/components/ui/address';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, InlineError, SkeletonList } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { useToast } from '@/components/ui/toast';
import { apiPost, describeError } from '@/lib/api/client';
import { useOpsKyc } from '@/lib/api/hooks';
import { OpsActionResponseSchema } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/utils';

export function OpsKyc() {
  return (
    <OpsShell title="KYC and KYB approvals" lead="Investors are approved on-chain at sign-up on testnet. Importers need a person to check the registration; approval also sends the testnet grant.">
      <Inner />
    </OpsShell>
  );
}

function Inner() {
  const q = useOpsKyc();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (q.isPending) return <SkeletonList count={2} />;
  if (q.isError) return <ErrorState title="Could not load applications" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  async function approve(id: string) {
    setError(null);
    setBusy(id);
    try {
      const r = await apiPost(`/ops/kyc/${id}/approve`, {}, OpsActionResponseSchema);
      toast.push({ tone: 'success', title: 'Approved', body: r.txHash ? <TxLink hash={r.txHash} /> : r.message ?? undefined });
      void q.refetch();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-3">
      {error ? <InlineError>{error}</InlineError> : null}
      {q.data.length === 0 ? (
        <EmptyState title="No applications waiting" />
      ) : (
        q.data.map((a) => (
          <Card key={a.id}>
            <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  {a.legalName ?? a.displayName} <span className="font-normal text-ink-muted">· {a.kind} · {a.country}</span>
                </p>
                <p className="text-ink-muted">
                  {a.displayName}
                  {a.registrationNumber ? ` · registration ${a.registrationNumber}` : ''} · submitted {formatDateTime(a.submittedAt)}
                </p>
                {a.walletAddress ? <Address value={a.walletAddress} /> : null}
                <p className="text-xs text-ink-muted">{a.documents.length ? a.documents.map((d) => d.filename).join(', ') : 'No document uploaded'}</p>
              </div>
              <Button onClick={() => approve(a.id)} loading={busy === a.id} data-testid={`kyc-approve-${a.id.slice(0, 6)}`}>
                Approve
              </Button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
