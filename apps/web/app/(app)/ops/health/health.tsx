'use client';
import { useQuery } from '@tanstack/react-query';
import { OpsShell } from '@/components/ops/ops-shell';
import { Address } from '@/components/ui/address';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KV } from '@/components/ui/kv';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { ContractLink } from '@/components/ui/tx-link';
import { describeError } from '@/lib/api/client';
import { useHealth } from '@/lib/api/hooks';
import { usePublicConfig } from '@/lib/config';
import { makeQafilaClient } from '@/lib/stellar/client';
import { formatDateTime } from '@/lib/utils';

export function OpsHealth() {
  return (
    <OpsShell title="System health" lead="Adapter modes, RPC, indexer lag, what the contract owes charity and the treasury, feature flags.">
      <Inner />
    </OpsShell>
  );
}

function Inner() {
  const h = useHealth();
  const { data: config } = usePublicConfig();
  const owed = useQuery({
    queryKey: ['owed', config?.contractId],
    enabled: Boolean(config?.contractId),
    refetchInterval: 30_000,
    retry: false,
    queryFn: async () => {
      const tx = await makeQafilaClient(config!).owed();
      return tx.result;
    },
  });
  if (h.isPending) return <SkeletonCard lines={6} />;
  if (h.isError) return <ErrorState title="The API did not answer" body={describeError(h.error)} onRetry={() => void h.refetch()} />;
  const x = h.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader eyebrow={`Checked ${formatDateTime(x.time)}`} title="API and chain" action={<Badge tone={x.ok ? 'success' : 'danger'}>{x.ok ? 'healthy' : 'degraded'}</Badge>} />
        <CardBody>
          <KV
            rows={[
              { k: 'RPC', v: <span>{x.rpc.ok ? 'reachable' : <span className="text-danger">down</span>}{x.rpc.latencyMs !== null ? ` · ${x.rpc.latencyMs} ms` : ''}{x.rpc.protocol ? ` · protocol ${x.rpc.protocol}` : ''}</span> },
              { k: 'Database', v: x.db.ok ? `ok${x.db.latencyMs !== null ? ` · ${x.db.latencyMs} ms` : ''}` : <span className="text-danger">down</span> },
              { k: 'Indexer lag', v: x.indexerLagSecs === null ? 'unknown' : <span className={x.indexerLagSecs > 30 ? 'text-warning' : ''}>{x.indexerLagSecs} s</span> },
              { k: 'API version', v: x.version },
              config?.contractId ? { k: 'Contract', v: <ContractLink id={config.contractId} /> } : { k: 'Contract', v: <span className="text-warning">not deployed</span> },
              config?.verifierPublicKey ? { k: 'Verifier key', v: <code className="font-mono text-xs">{config.verifierPublicKey.slice(0, 16)}…</code> } : null,
              config?.smartAccount.relayerUrl ? { k: 'Relayer', v: <span className="break-all text-xs">{config.smartAccount.relayerUrl}</span> } : { k: 'Relayer', v: <span className="text-warning">none, passkey calls cannot be sponsored</span> },
              config?.charityAddress ? { k: 'Charity address', v: <Address value={config.charityAddress} /> } : null,
              config?.treasuryAddress ? { k: 'Treasury address', v: <Address value={config.treasuryAddress} /> } : null,
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader eyebrow="Live from the contract" title="Owed amounts" />
        <CardBody>
          {owed.isPending && config?.contractId ? (
            <SkeletonCard lines={3} />
          ) : owed.data ? (
            <KV rows={[{ k: 'Charity owed (not yet swept)', v: <Amount value={owed.data.charity} /> }, { k: 'Treasury owed', v: <Amount value={owed.data.treasury} /> }, { k: 'Promises held', v: <Amount value={owed.data.promises_held} /> }, { k: 'Refunds owed', v: <Amount value={owed.data.refunds} /> }]} />
          ) : (
            <p className="text-sm text-ink-muted">{config?.contractId ? 'Could not read the contract.' : 'No contract deployed on this network.'}</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader eyebrow="Adapters" title="Live or recorded" />
        <CardBody>
          <ul className="flex flex-wrap gap-2">
            {Object.entries(x.adapters).map(([k, m]) => (
              <li key={k}>
                <Badge tone={m === 'live' ? 'success' : m === 'mock' ? 'warning' : 'neutral'}>
                  {k}: {m}
                </Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader eyebrow="Feature flags" title="What renders" />
        <CardBody>
          <ul className="flex flex-wrap gap-2">
            {config
              ? Object.entries(config.flags).map(([k, v]) => (
                  <li key={k}>
                    <Badge tone={v ? 'indigo' : 'neutral'}>
                      {k.replace('FF_', '').toLowerCase()}: {v ? 'on' : 'off'}
                    </Badge>
                  </li>
                ))
              : null}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
