'use client';
import { OpsShell } from '@/components/ops/ops-shell';
import { Address } from '@/components/ui/address';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/states';
import { Timeline } from '@/components/ui/timeline';
import { TxLink } from '@/components/ui/tx-link';
import { describeError } from '@/lib/api/client';
import { useOpsAgent } from '@/lib/api/hooks';
import { formatDateTime } from '@/lib/utils';

export function OpsAgent() {
  return (
    <OpsShell title="Shipment agent" lead="Every decision with its inputs, reasoning and transaction. Incidents need a person.">
      <Inner />
    </OpsShell>
  );
}

function Inner() {
  const q = useOpsAgent();
  if (q.isPending) return <SkeletonList count={2} />;
  if (q.isError) return <ErrorState title="Could not load the agent log" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  const a = q.data;
  const open = a.incidents.filter((i) => i.status === 'open');
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Card>
          <CardHeader eyebrow={`${a.actions.length} actions`} title="Actions" />
          <CardBody>
            {a.actions.length ? (
              <Timeline
                items={a.actions.map((x) => ({
                  key: x.id,
                  title: `${x.dealNumber !== null ? `Deal ${x.dealNumber}: ` : ''}${x.action.replaceAll('_', ' ')} (${x.decision})`,
                  body: x.reasoning,
                  when: formatDateTime(x.at),
                  tone: x.status === 'failed' ? 'danger' : x.status === 'dry_run' ? 'warning' : x.status === 'skipped' ? 'default' : 'success',
                  action: x.txHash ? <TxLink hash={x.txHash} short /> : undefined,
                }))}
              />
            ) : (
              <EmptyState title="The agent has not acted yet" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader eyebrow={`${open.length} open`} title="Incidents" />
          <CardBody>
            {a.incidents.length ? (
              <Timeline items={a.incidents.map((i) => ({ key: i.id, title: `${i.dealNumber !== null ? `Deal ${i.dealNumber}: ` : ''}${i.kind}`, body: i.detail, when: formatDateTime(i.at), tone: i.status === 'open' ? 'danger' : 'default' }))} />
            ) : (
              <EmptyState title="No incidents" body="The agent opens one when tracking contradicts the bill of lading, a payout address is missing or a check did not pass." />
            )}
          </CardBody>
        </Card>
      </div>
      <aside className="space-y-4">
        <Card>
          <CardHeader eyebrow="Wallet" title="Agent smart account" action={<Badge tone={a.mode === 'live' ? 'success' : a.mode === 'dry_run' ? 'warning' : 'neutral'}>{a.mode.replace('_', ' ')}</Badge>} />
          <CardBody className="space-y-2 text-sm">
            {a.agentAddress ? <Address value={a.agentAddress} head={6} tail={6} /> : <p className="text-ink-muted">Not configured</p>}
            <p className="text-ink-muted">Its rule only allows calls to the Qafila contract. It can only pay the supplier deposit and confirm a shipment with a valid verifier signature; everything else it does is open to anyone.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader eyebrow={`${a.deadJobs.length}`} title="Dead jobs" />
          <CardBody className="text-sm">
            {a.deadJobs.length ? (
              <ul className="space-y-1">
                {a.deadJobs.map((j) => (
                  <li key={j.id}>
                    <span className="font-medium">{j.kind}</span> after {j.attempts} attempts: <span className="text-danger">{j.lastError ?? 'unknown error'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-muted">None. Jobs retry up to 5 times with backoff.</p>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
