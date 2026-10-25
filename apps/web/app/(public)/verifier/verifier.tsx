'use client';
/** Verifier page (PLAN 9.2): the public key and how to verify a report, on-chain or offline. */
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KV } from '@/components/ui/kv';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { ContractLink } from '@/components/ui/tx-link';
import { API_BASE, describeError } from '@/lib/api/client';
import { usePublicConfig } from '@/lib/config';

export function VerifierPage() {
  const q = usePublicConfig();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="For auditors, lenders and agents" title="Verifier key" lead="Every AI report is canonical JSON, hashed and signed by Qafila's verifier key. The hash of the listing report is written into the deal's terms and the contract checks the signature before listing or confirming a shipment." />
      {q.isPending ? (
        <SkeletonCard lines={5} />
      ) : q.isError ? (
        <ErrorState title="Could not load the configuration" body={describeError(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader eyebrow="Current" title="Key and contract" />
            <CardBody>
              <KV
                rows={[
                  { k: 'Network', v: q.data.network },
                  { k: 'Verifier public key (ed25519, hex)', v: q.data.verifierPublicKey ? <code className="break-all font-mono text-xs">{q.data.verifierPublicKey}</code> : <span className="text-warning">not published yet</span> },
                  { k: 'Qafila contract', v: q.data.contractId ? <ContractLink id={q.data.contractId} label={q.data.contractId.slice(0, 10) + '…'} /> : <span className="text-warning">not deployed</span> },
                  { k: 'Machine-readable', v: <a className="text-indigo hover:underline" href={`${API_BASE}/.well-known/qafila-verifier.json`} target="_blank" rel="noreferrer">/.well-known/qafila-verifier.json</a> },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader eyebrow="How to verify" title="Three ways" />
            <CardBody className="space-y-3 text-sm">
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  <strong>Hash the report.</strong> Take the report JSON, canonicalise it (RFC 8785) and SHA-256 it. The result must equal <code className="font-mono">report_hash</code>.
                </li>
                <li>
                  <strong>Check the signature offline.</strong> Rebuild the message <code className="font-mono">sha256(&quot;QAFILA-ATTEST-V1&quot; || purpose u32 || network id || contract address XDR || deal id u64 || payload hash)</code> and verify the ed25519 signature with the key above. Purposes: 1 list, 2 shipped, 10 report.
                </li>
                <li>
                  <strong>Ask the contract.</strong> Call <code className="font-mono">verify_attestation(purpose, deal_id, payload_hash, sig)</code>; it succeeds silently or traps, so other contracts use <code className="font-mono">try_verify_attestation</code>.
                </li>
              </ol>
              <p className="text-ink-muted">Reports bought over the x402 API (purpose 10, deal id 0) verify the same way.</p>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
