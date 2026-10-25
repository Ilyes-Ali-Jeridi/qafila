'use client';
/** Ops actions on one deal: list, pay deposit, override, abort with the O-5 reason picker, default, recovery, finalize, extension, B/L release. */
import { useState, type ReactNode } from 'react';
import { ABORT_REASONS, parseAmount, type AbortReason } from '@qafila/shared';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input';
import { InlineError, InlineNotice } from '@/components/ui/states';
import { TxLink } from '@/components/ui/tx-link';
import { useToast } from '@/components/ui/toast';
import { apiPost, describeError } from '@/lib/api/client';
import { useRefreshDeal } from '@/lib/api/hooks';
import { OpsActionResponseSchema, type OpsDealDetail } from '@/lib/api/schemas';
import { useFlag, usePublicConfig } from '@/lib/config';
import { formatDateTime, nowSecs } from '@/lib/utils';

function useAction(dealId: string) {
  const refresh = useRefreshDeal();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(key: string, path: string, body: unknown, title: string) {
    setError(null);
    setBusy(key);
    try {
      const r = await apiPost(`/ops/deals/${dealId}/${path}`, body, OpsActionResponseSchema);
      toast.push({ tone: 'success', title, body: r.txHash ? <TxLink hash={r.txHash} /> : r.message ?? undefined });
      refresh(dealId);
      return r;
    } catch (e) {
      setError(describeError(e));
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { run, busy, error };
}

export function OpsActions({ deal }: { deal: OpsDealDetail }) {
  const a = useAction(deal.id);
  const extensions = useFlag('FF_EXTENSIONS');
  const { data: config } = usePublicConfig();
  const s = deal.stage;
  const panels: ReactNode[] = [];

  if (['review', 'approved', 'rejected', 'verifying'].includes(s) && deal.reportSummary) panels.push(<Override key="override" deal={deal} a={a} />);
  if (s === 'approved' || s === 'promised') panels.push(<ListDeal key="list" deal={deal} a={a} />);
  if (s === 'funded') {
    panels.push(
      <ActionCard key="deposit" eyebrow="Step 8" title="Pay the supplier deposit">
        <p className="text-sm text-ink-muted">The agent pays it when the registry and sanctions checks passed, the payout address is on record and no incident is open. Press when it has not.</p>
        <p className="text-sm">
          Supplier {deal.supplier.nameEn}, <Amount value={(BigInt(deal.terms.cost) * BigInt(deal.terms.depositBps)) / 10000n} className="font-medium" /> ({deal.terms.depositBps / 100}% of cost)
        </p>
        <Button onClick={() => a.run('deposit', 'pay-deposit', {}, 'Supplier deposit paid')} loading={a.busy === 'deposit'} data-testid="ops-pay-deposit">
          Pay deposit now
        </Button>
      </ActionCard>,
    );
  }
  if (s === 'deposit_paid' && deal.shipment) {
    panels.push(
      <ActionCard key="confirm" eyebrow="Step 9" title="Agent shipment check">
        <p className="text-sm text-ink-muted">B/L {deal.shipment.blNumber} ({deal.shipment.carrier}, {deal.shipment.containers.join(', ')}). The agent confirms on-chain once the carrier&apos;s loading event matches; run the check now instead of waiting for the tick.</p>
        <Button variant="outline" onClick={() => a.run('confirm', 'confirm-shipment', {}, 'Shipment check ran')} loading={a.busy === 'confirm'}>
          Run the agent check now
        </Button>
      </ActionCard>,
    );
  }
  if (s === 'sold' && !deal.blReleasedAt) panels.push(<ReleaseBl key="bl" deal={deal} a={a} />);
  if (extensions && s === 'sold' && deal.extension?.decision === 'pending') panels.push(<Extension key="ext" deal={deal} a={a} maxSecs={config?.flags ? 600 : 600} />);
  if (s === 'sold' && deal.onchain && nowSecs() > deal.onchain.due_at + 60 && BigInt(deal.onchain.principal_repaid) < BigInt(deal.onchain.sale_price)) panels.push(<MarkDefault key="default" deal={deal} a={a} />);
  if (['listed', 'funded', 'deposit_paid', 'owned'].includes(s)) panels.push(<Abort key="abort" deal={deal} a={a} />);
  if (s === 'defaulted') panels.push(<Recovery key="recovery" deal={deal} a={a} />);

  if (panels.length === 0) {
    panels.push(
      <ActionCard key="none" eyebrow="Actions" title="Nothing for ops to do right now">
        <p className="text-sm text-ink-muted">{deal.nextAction}</p>
      </ActionCard>,
    );
  }
  return (
    <div className="space-y-4">
      {a.error ? <InlineError>{a.error}</InlineError> : null}
      {panels}
    </div>
  );
}

function ActionCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader eyebrow={eyebrow} title={title} />
      <CardBody className="space-y-3">{children}</CardBody>
    </Card>
  );
}

type A = ReturnType<typeof useAction>;

function Override({ deal, a }: { deal: OpsDealDetail; a: A }) {
  const [decision, setDecision] = useState<'approve' | 'review' | 'reject'>(deal.reportSummary?.decision ?? 'review');
  const [reason, setReason] = useState('');
  return (
    <ActionCard eyebrow="O-2" title="Override the decision">
      <p className="text-sm text-ink-muted">Current: {deal.reportSummary?.decision}. Every exception is written to the audit log with your reason, and a registry override counts as passed for the agent.</p>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="New decision" htmlFor="ov-dec">
          <Select id="ov-dec" value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
            <option value="approve">Approve</option>
            <option value="review">Review</option>
            <option value="reject">Reject</option>
          </Select>
        </Field>
        <Field label="Reason (required)" htmlFor="ov-reason" hint="At least 10 characters. Say what you checked.">
          <Textarea id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="override-reason" />
        </Field>
      </div>
      <Button variant="outline" onClick={() => a.run('override', 'override', { decision, reason }, `Decision set to ${decision}`)} loading={a.busy === 'override'} disabled={reason.trim().length < 10 || decision === deal.reportSummary?.decision} data-testid="override-submit">
        Record override
      </Button>
    </ActionCard>
  );
}

function ListDeal({ deal, a }: { deal: OpsDealDetail; a: A }) {
  const [result, setResult] = useState<Record<string, string> | null>(deal.listing?.txHashes ?? null);
  const ready = Boolean(deal.promise?.txHash) && deal.reportSummary?.decision === 'approve';
  const labels: Record<string, string> = { issuer_created: 'Issuer account created', flags_set: 'AUTH_REQUIRED, AUTH_REVOCABLE, AUTH_CLAWBACK_ENABLED set', sac_deployed: 'Share token (SAC) deployed', admin_set: 'SAC admin set to the Qafila contract', issuer_locked: 'Issuer master key weight 0', list_deal: 'list_deal with the verifier signature' };
  return (
    <ActionCard eyebrow="O-3" title="List the deal">
      {!deal.promise?.txHash ? <InlineNotice tone="warning">Waiting for the importer to sign the purchase promise and lock the deposit.</InlineNotice> : null}
      {deal.reportSummary?.decision !== 'approve' ? <InlineNotice tone="warning">The decision must be approve (override above if you checked manually).</InlineNotice> : null}
      <p className="text-sm text-ink-muted">One click runs the share-token factory, signs the LIST attestation over the terms (deposit included) and calls list_deal. Each step shows its transaction.</p>
      {result ? (
        <ul className="space-y-1 text-sm">
          {Object.entries(result).map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-2">
              <span>{labels[k] ?? k}</span>
              <TxLink hash={v} short />
            </li>
          ))}
        </ul>
      ) : null}
      {!deal.state ? (
        <Button
          onClick={async () => {
            const r = await a.run('list', 'list', {}, `Deal ${deal.number} listed`);
            if (r?.txHashes) setResult(r.txHashes);
          }}
          loading={a.busy === 'list'}
          disabled={!ready}
          data-testid="ops-list"
        >
          List deal
        </Button>
      ) : null}
    </ActionCard>
  );
}

function Abort({ deal, a }: { deal: OpsDealDetail; a: A }) {
  const [reason, setReason] = useState<AbortReason>('red_flag_before_payment');
  const derived = ABORT_REASONS[reason].atFault;
  const [override, setOverride] = useState(false);
  const [note, setNote] = useState('');
  const atFault = override ? !derived : derived;
  const beforePayment = deal.stage === 'listed' || deal.stage === 'funded';
  return (
    <ActionCard eyebrow="O-5" title="Stop or abort this deal">
      <p className="text-sm text-ink-muted">
        {beforePayment ? 'Nothing has been paid out: everyone gets 100% back, the deposit included.' : 'Money has reached the supplier: the deal goes to the default path. "At fault" follows from the reason and decides whether the importer’s deposit may cover the actual loss.'}
      </p>
      <Field label="Reason" htmlFor="ab-reason">
        <Select id="ab-reason" value={reason} onChange={(e) => { setReason(e.target.value as AbortReason); setOverride(false); }} data-testid="abort-reason">
          {Object.entries(ABORT_REASONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </Field>
      {!beforePayment ? (
        <div className="rounded-md border border-line bg-surface-2 p-3 text-sm">
          <p>
            Importer at fault: <strong>{derived ? 'yes' : 'no'}</strong> <span className="text-ink-muted">(from the reason)</span>
          </p>
          <Checkbox id="ab-override" checked={override} onChange={(e) => setOverride(e.target.checked)} label={`Change to ${derived ? 'no' : 'yes'} (needs a note; the Sharia board reviews every change)`} className="mt-2" />
          {override ? <p className="mt-1 text-xs text-warning">Final: importer at fault = {atFault ? 'yes' : 'no'}.</p> : null}
        </div>
      ) : null}
      <Field label="Note (required)" htmlFor="ab-note" hint="Logged for the Sharia board.">
        <Textarea id="ab-note" value={note} onChange={(e) => setNote(e.target.value)} data-testid="abort-note" />
      </Field>
      <Button variant="danger" onClick={() => a.run('abort', 'abort', { reason, importerAtFault: beforePayment ? undefined : atFault, note }, 'Deal stopped')} loading={a.busy === 'abort'} disabled={note.trim().length < 3 || (override && note.trim().length < 10)} data-testid="abort-submit">
        {beforePayment ? 'Stop and refund everyone' : 'Abort to the default path'}
      </Button>
    </ActionCard>
  );
}

function MarkDefault({ deal, a }: { deal: OpsDealDetail; a: A }) {
  const [note, setNote] = useState('');
  return (
    <ActionCard eyebrow="O-6" title="Mark default">
      <p className="text-sm text-ink-muted">Due {deal.onchain ? formatDateTime(deal.onchain.due_at) : ''} plus the grace period has passed with <Amount value={BigInt(deal.onchain?.sale_price ?? '0') - BigInt(deal.onchain?.principal_repaid ?? '0')} /> outstanding. Recovery notes follow.</p>
      <Field label="Note" htmlFor="def-note">
        <Textarea id="def-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Button variant="danger" onClick={() => a.run('default', 'default', { note }, 'Marked in default')} loading={a.busy === 'default'} disabled={note.trim().length < 3}>
        Mark default
      </Button>
    </ActionCard>
  );
}

function Recovery({ deal, a }: { deal: OpsDealDetail; a: A }) {
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [note, setNote] = useState('');
  const [fin, setFin] = useState('');
  const owed = deal.onchain && deal.onchain.sale_price !== '0' ? BigInt(deal.onchain.sale_price) - BigInt(deal.onchain.principal_repaid) - BigInt(deal.onchain.recovered) : null;
  let parsed: bigint | null = null;
  try {
    parsed = amount ? parseAmount(amount) : null;
  } catch {
    parsed = null;
  }
  return (
    <>
      <ActionCard eyebrow="O-6" title="Record a recovery">
        <p className="text-sm text-ink-muted">Supplier refunds, insurance, resale, collection. {owed !== null ? <>Recoveries can never exceed what is still owed: <Amount value={owed} className="font-medium" />.</> : null}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" htmlFor="rc-amount">
            <Input id="rc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="From (G or C address, optional)" htmlFor="rc-from">
            <Input id="rc-from" value={from} onChange={(e) => setFrom(e.target.value.trim())} className="font-mono" />
          </Field>
        </div>
        <Field label="Note" htmlFor="rc-note" hint="Shown to investors on the recovery timeline.">
          <Textarea id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button onClick={() => a.run('recovery', 'recovery', { amount: parsed?.toString(), from: from || undefined, note }, 'Recovery recorded')} loading={a.busy === 'recovery'} disabled={!parsed || parsed <= 0n || note.trim().length < 3}>
          Deposit recovery
        </Button>
      </ActionCard>
      <ActionCard eyebrow="O-6" title="Finalize">
        <p className="text-sm text-ink-muted">Closes recovery: the importer&apos;s deposit covers the actual loss (never more), the rest goes back to them, and investors share what is in the deal pro rata.</p>
        <Field label="Final note" htmlFor="fin-note">
          <Textarea id="fin-note" value={fin} onChange={(e) => setFin(e.target.value)} />
        </Field>
        <Button variant="danger" onClick={() => a.run('finalize', 'finalize', { note: fin }, 'Deal wound up')} loading={a.busy === 'finalize'} disabled={fin.trim().length < 3}>
          Finalize default
        </Button>
      </ActionCard>
    </>
  );
}

function Extension({ deal, a, maxSecs }: { deal: OpsDealDetail; a: A; maxSecs: number }) {
  const due = deal.onchain?.due_at ?? 0;
  const [extra, setExtra] = useState(String(Math.min(maxSecs, 600)));
  const [note, setNote] = useState('');
  return (
    <ActionCard eyebrow="O-7" title="Extension request">
      <Callout tone="neutral" title="The importer wrote">
        <p>{deal.extension?.reason}</p>
      </Callout>
      <p className="text-sm text-ink-muted">One extension per deal, price unchanged, late fee only after the new date. Up to {maxSecs} seconds on this network.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Extra seconds" htmlFor="ext-secs">
          <Input id="ext-secs" inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="ext-note">
          <Input id="ext-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => a.run('extend', 'extend', { newDueAt: due + Number(extra), note }, 'Due date extended')} loading={a.busy === 'extend'} disabled={!Number(extra) || Number(extra) > maxSecs || note.trim().length < 3}>
          Grant
        </Button>
        <Button variant="outline" onClick={() => a.run('refuse', 'refuse-extension', { note }, 'Extension refused')} loading={a.busy === 'refuse'} disabled={note.trim().length < 3}>
          Refuse
        </Button>
      </div>
    </ActionCard>
  );
}

function ReleaseBl({ deal, a }: { deal: OpsDealDetail; a: A }) {
  const [note, setNote] = useState('');
  return (
    <ActionCard eyebrow="O-8" title="Release the bill of lading">
      <p className="text-sm text-ink-muted">The importer signed the sale. Record the hand-over of the B/L {deal.shipment?.blNumber ?? ''} so the goods&apos; transfer is on the record.</p>
      <Field label="Note" htmlFor="bl-note" hint="How it was released (e-B/L transfer, courier, telex).">
        <Input id="bl-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Button variant="outline" onClick={() => a.run('bl', 'release-bl', { note }, 'B/L release recorded')} loading={a.busy === 'bl'} disabled={note.trim().length < 3}>
        Record release
      </Button>
    </ActionCard>
  );
}
