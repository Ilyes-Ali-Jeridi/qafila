/**
 * Shipment agent (PLAN 6, FLOWS A-1 to A-3). Runs on every `funded` event, every B/L
 * verification and a 10-minute tick. Idempotent per deal (database lock through the
 * job queue plus an on-chain state check). Dry-run mode (AGENT_DRY_RUN) simulates only.
 * Every decision is stored in agent_actions with inputs, reasoning and transaction hash.
 *
 * Job 1: pay the supplier deposit on Funded deals when the payout address is on record,
 *        registry and sanctions passed (or ops overrode the registry after a manual
 *        check), no incident is open, and with FF_SUPPLIER_CONFIRM the supplier accepted.
 * Job 2: confirm the shipment on DepositPaid deals when the shipment-stage report is
 *        approved: B/L to order of Qafila, loading event matches, fingerprint unused.
 * Job 3: housekeeping: sweep charity, send refunds, claim for holders after 24 h, close.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { fromHex } from '@qafila/shared/attestation';
import { agentActions, checks as checksTable, deals, incidents, onchainEvents, reports, shipments, supplierConfirmations, suppliers } from '../db/schema.js';
import { enqueue } from '../db/repo.js';
import { logger } from '../lib/logger.js';
import { signShipped } from '../pipeline/attest.js';
import type { Services } from '../services.js';
import { openIncident, ONCHAIN_STATUS } from '../services/deals.js';
import { releaseEscrowMilestone } from '../services/escrow.js';

const log = logger.child({ module: 'agent' });

export interface AgentOutcome {
  action: string;
  decision: 'confirmed' | 'paid' | 'skipped' | 'incident' | 'failed' | 'dry_run' | 'noop';
  reasoning: string;
  txHash: string | null;
}

async function record(svc: Services, dealId: string | null, action: string, decision: AgentOutcome['decision'], reasoning: string, inputs: unknown, txHash: string | null, dryRun: boolean): Promise<AgentOutcome> {
  await svc.db.insert(agentActions).values({ dealId, action, decision, reasoning, inputs: inputs as object, txHash, status: decision === 'failed' ? 'failed' : decision === 'skipped' || decision === 'noop' || decision === 'incident' ? 'skipped' : 'done', dryRun });
  log.info({ deal: dealId, action, decision, tx: txHash }, dryRun ? 'agent (DRY RUN)' : 'agent');
  return { action, decision, reasoning, txHash };
}

/**
 * A-1 gate over the report's checks with a name prefix (`registry.`, `sanctions.`): every
 * check must be `pass`. `skipped` (no company code, no names to screen) and `unavailable`
 * are not passes: only an ops registry override after a manual check unblocks the deposit
 * (review finding R-2).
 */
export function gateChecks(rows: Array<{ name: string; status: string }>, prefix: string): { failed: string[]; passed: boolean } {
  const relevant = rows.filter((r) => r.name.startsWith(prefix));
  const failed = relevant.filter((r) => r.status !== 'pass').map((r) => `${r.name}:${r.status}`);
  return { failed, passed: relevant.length > 0 && failed.length === 0 };
}

async function checkStatus(svc: Services, reportId: string, prefix: string): Promise<{ failed: string[]; passed: boolean }> {
  const rows = await svc.db.query.checks.findMany({ where: eq(checksTable.reportId, reportId) });
  return gateChecks(rows, prefix);
}

/** Job 1 and Job 2 for one deal. `force` lets ops run the confirmation as admin. */
export async function runAgentForDeal(svc: Services, dealId: string, opts: { as?: 'admin' | 'agent'; actor?: string | null; force?: boolean } = {}): Promise<AgentOutcome> {
  const as = opts.as ?? 'agent';
  const dryRun = Boolean(svc.env.AGENT_DRY_RUN) && !opts.force;
  const deal = await svc.db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!deal?.onchainId) return { action: 'tick', decision: 'noop', reasoning: 'deal not on-chain', txHash: null };
  const on = await svc.chain.getDeal(deal.onchainId);
  if (!on) return { action: 'tick', decision: 'noop', reasoning: 'deal not found on-chain', txHash: null };
  if (ONCHAIN_STATUS[on.state] !== deal.status) await svc.db.update(deals).set({ status: ONCHAIN_STATUS[on.state], updatedAt: new Date() }).where(eq(deals.id, deal.id));
  const open = await svc.db.query.incidents.findMany({ where: and(eq(incidents.dealId, deal.id), eq(incidents.status, 'open')) });

  if (on.state === 'Funded') {
    const supplier = deal.supplierId ? await svc.db.query.suppliers.findFirst({ where: eq(suppliers.id, deal.supplierId) }) : null;
    const reasons: string[] = [];
    if (!supplier?.payoutAddress) reasons.push('no supplier payout address on record');
    const reg = deal.reportId ? await checkStatus(svc, deal.reportId, 'registry.') : { failed: ['no report'], passed: false };
    const override = Boolean((deal.terms as { registry_override?: boolean } | null)?.registry_override);
    if (!reg.passed && !override) reasons.push(`registry check not passed (${reg.failed.join(', ') || 'no checks'})`);
    const sanc = deal.reportId ? await checkStatus(svc, deal.reportId, 'sanctions.') : { failed: ['no report'], passed: false };
    if (!sanc.passed) reasons.push(`sanctions check not passed (${sanc.failed.join(', ') || 'no checks'})`);
    if (open.length) reasons.push(`open incident: ${open.map((i) => i.kind).join(', ')}`);
    if (svc.env.FF_SUPPLIER_CONFIRM) {
      const conf = await svc.db.query.supplierConfirmations.findFirst({ where: eq(supplierConfirmations.dealId, deal.id), orderBy: desc(supplierConfirmations.createdAt) });
      if (!conf?.acceptedAt) reasons.push('supplier has not accepted the purchase order');
      else if (conf.payoutAddress && supplier?.payoutAddress && conf.payoutAddress !== supplier.payoutAddress) reasons.push('confirmed payout address differs from the one on record');
    }
    const inputs = { state: on.state, supplier: supplier?.payoutAddress ?? null, registry: reg, sanctions: sanc, override, openIncidents: open.length };
    if (reasons.length) {
      await openIncident(svc.db, deal.id, 'deposit_blocked', `The agent did not pay the supplier deposit: ${reasons.join('; ')}.`);
      return record(svc, deal.id, 'pay_supplier_deposit', 'incident', reasons.join('; '), inputs, null, dryRun);
    }
    try {
      const tx = await svc.chain.paySupplierDeposit(deal.onchainId, as, dryRun);
      if (dryRun) return record(svc, deal.id, 'pay_supplier_deposit', 'dry_run', `would pay ${String(tx.result)} to ${supplier?.payoutAddress}`, inputs, null, true);
      await svc.db.update(deals).set({ status: 'deposit_paid', updatedAt: new Date() }).where(eq(deals.id, deal.id));
      await enqueue(svc.db, 'notify', { kind: 'deposit_paid', dealId: deal.id, amount: String(tx.result ?? '') });
      const paid = await record(svc, deal.id, 'pay_supplier_deposit', 'paid', `Supplier deposit paid: registry and sanctions passed${override ? ' (registry by ops override)' : ''}, no incident open.`, inputs, tx.txHash, false);
      // S2: the deposit went into the Trustless Work escrow; approve and release milestone 1 to the supplier.
      if (deal.paymentMode === 'TrustlessWork') await releaseEscrowMilestone(svc, deal, 0, { dryRun: false, trigger: 'deposit_paid' });
      return paid;
    } catch (e) {
      await openIncident(svc.db, deal.id, 'deposit_failed', `pay_supplier_deposit failed: ${(e as Error).message.slice(0, 300)}`);
      return record(svc, deal.id, 'pay_supplier_deposit', 'failed', (e as Error).message.slice(0, 300), inputs, null, dryRun);
    }
  }

  if (on.state === 'DepositPaid') {
    const shipment = await svc.db.query.shipments.findFirst({ where: eq(shipments.dealId, deal.id) });
    if (!shipment) return record(svc, deal.id, 'confirm_shipment', 'noop', 'no bill of lading uploaded yet', { state: on.state }, null, dryRun);
    if (!deal.blReportId) return record(svc, deal.id, 'confirm_shipment', 'noop', 'shipment report not ready', { state: on.state }, null, dryRun);
    const report = await svc.db.query.reports.findFirst({ where: eq(reports.id, deal.blReportId) });
    if (!report) return record(svc, deal.id, 'confirm_shipment', 'noop', 'shipment report missing', {}, null, dryRun);
    const inputs = { state: on.state, reportHash: report.hash, decision: report.decision, blNumber: shipment.blNumber, containers: shipment.containerNumbers };
    if (report.decision !== 'approve') {
      // FLOWS 9: the agent never confirms a shipment under review; 72 h with no tracking alerts ops.
      const since = Date.now() - shipment.createdAt.getTime();
      const kind = report.decision === 'reject' ? 'shipment_rejected' : since > 72 * 3600 * 1000 ? 'tracking_silent_72h' : 'shipment_review';
      await openIncident(svc.db, deal.id, kind, `Shipment report is "${report.decision}" (hash ${report.hash.slice(0, 12)}); the agent takes no on-chain action.`);
      return record(svc, deal.id, 'confirm_shipment', 'incident', `shipment report decision is ${report.decision}; no on-chain action`, inputs, null, dryRun);
    }
    if (open.length) return record(svc, deal.id, 'confirm_shipment', 'incident', `open incident: ${open.map((i) => i.kind).join(', ')}`, inputs, null, dryRun);
    const fp = deal.shipmentFingerprint;
    if (!fp) return record(svc, deal.id, 'confirm_shipment', 'incident', 'shipment fingerprint missing on the deal', inputs, null, dryRun);
    if (!svc.verifierSecret || !svc.contractId) return record(svc, deal.id, 'confirm_shipment', 'failed', 'verifier key or contract id missing', inputs, null, dryRun);
    const { signature } = signShipped({ verifierSecret: svc.verifierSecret, contractId: svc.contractId, networkPassphrase: svc.env.NETWORK_PASSPHRASE, dealId: deal.onchainId, blFingerprintHex: fp, blReportHashHex: report.hash });
    const checksRows = await svc.db.query.checks.findMany({ where: eq(checksTable.reportId, report.id) });
    const loading = checksRows.find((x) => x.name === 'tracking.loading_vessel');
    const ev = (loading?.evidence as { evidence?: { loading_vessel?: string; loading_port?: string; loading_date?: string } } | null)?.evidence;
    const reasoning = `Agent confirmed shipment: vessel ${ev?.loading_vessel ?? 'n/a'} loaded at ${ev?.loading_port ?? 'the port of loading'} on ${ev?.loading_date ?? 'n/a'}; B/L to order of ${svc.env.QAFILA_ENTITY_NAME}; report ${report.hash.slice(0, 12)} signed (purpose 2).`;
    try {
      const tx = await svc.chain.confirmShipment(deal.onchainId, fromHex(fp), fromHex(report.hash), signature, as, dryRun);
      if (dryRun) return record(svc, deal.id, 'confirm_shipment', 'dry_run', `would confirm and pay the balance ${String(tx.result)}`, inputs, null, true);
      await svc.db.update(deals).set({ status: 'owned', updatedAt: new Date() }).where(eq(deals.id, deal.id));
      await enqueue(svc.db, 'notify', { kind: 'shipment_confirmed', dealId: deal.id });
      await enqueue(svc.db, 'notify', { kind: 'sale_ready', dealId: deal.id });
      const confirmed = await record(svc, deal.id, 'confirm_shipment', 'confirmed', reasoning, inputs, tx.txHash, false);
      // S2: the balance went into the Trustless Work escrow; approve and release milestone 2 to the supplier.
      if (deal.paymentMode === 'TrustlessWork') await releaseEscrowMilestone(svc, deal, 1, { dryRun: false, trigger: 'shipment_confirmed' });
      return confirmed;
    } catch (e) {
      await openIncident(svc.db, deal.id, 'confirm_failed', `confirm_shipment failed: ${(e as Error).message.slice(0, 300)}`);
      return record(svc, deal.id, 'confirm_shipment', 'failed', (e as Error).message.slice(0, 300), inputs, null, dryRun);
    }
  }

  return { action: 'tick', decision: 'noop', reasoning: `nothing to do in state ${on.state}`, txHash: null };
}

/** Job 3: housekeeping across deals. */
export async function housekeeping(svc: Services, reason: string): Promise<string[]> {
  const out: string[] = [];
  const dryRun = Boolean(svc.env.AGENT_DRY_RUN);
  try {
    const owed = await svc.chain.owed();
    if (owed.charity > 0n && ['late_fee', 'closed', 'tick', 'finalize', 'abort'].some((r) => reason.includes(r))) {
      if (!dryRun) {
        const tx = await svc.chain.sweepCharity();
        await record(svc, null, 'sweep_charity', 'paid', `swept ${owed.charity.toString()} to charity after ${reason}`, { owed: owed.charity.toString() }, tx.txHash, false);
        out.push(`sweep_charity ${tx.txHash}`);
      } else out.push('sweep_charity (dry run)');
    }
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'sweep failed');
  }
  // Refunds after refund_owed events (FLOWS A-3)
  const refundEvents = await svc.db.query.onchainEvents.findMany({ where: eq(onchainEvents.eventType, 'refund_owed'), orderBy: desc(onchainEvents.ledger), limit: 50 });
  for (const e of refundEvents) {
    const importer = String((e.data as Record<string, unknown>)['importer'] ?? '');
    if (!importer) continue;
    const owedTo = await svc.chain.refundOf(importer).catch(() => 0n);
    if (owedTo <= 0n) continue;
    if (dryRun) {
      out.push(`withdraw_refund ${importer.slice(0, 6)} (dry run)`);
      continue;
    }
    try {
      const tx = await svc.chain.withdrawRefund(importer);
      const deal = e.dealOnchainId !== null ? await svc.db.query.deals.findFirst({ where: eq(deals.onchainId, e.dealOnchainId) }) : null;
      await record(svc, deal?.id ?? null, 'withdraw_refund', 'paid', `refund ${owedTo.toString()} sent to the importer`, { importer, amount: owedTo.toString() }, tx.txHash, false);
      if (deal) await enqueue(svc.db, 'notify', { kind: 'security_refunded', dealId: deal.id, amount: owedTo.toString() });
      out.push(`withdraw_refund ${tx.txHash}`);
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'withdraw_refund failed');
    }
  }
  // Claims 24 h after a deal becomes claimable, then close
  const claimable = await svc.db.query.deals.findMany({ where: inArray(deals.status, ['repaid', 'cancelled', 'liquidated']) });
  for (const d of claimable) {
    if (!d.onchainId) continue;
    const on = await svc.chain.getDeal(d.onchainId).catch(() => null);
    if (!on || !['Repaid', 'Cancelled', 'Liquidated'].includes(on.state)) continue;
    const terminalEvent = await svc.db.query.onchainEvents.findFirst({ where: and(eq(onchainEvents.dealOnchainId, d.onchainId), inArray(onchainEvents.eventType, ['repaid', 'cancelled', 'liquidated', 'aborted'])), orderBy: desc(onchainEvents.ledger) });
    const since = Date.now() - (terminalEvent?.ledgerClosedAt ?? terminalEvent?.createdAt ?? d.updatedAt).getTime();
    const delay = Number(process.env['AGENT_CLAIM_DELAY_MS'] ?? 24 * 3600 * 1000);
    if (BigInt(on.claimed_shares) < BigInt(on.funded) && since >= delay) {
      const holders = await svc.chain.holders(d.onchainId).catch(() => []);
      for (const h of holders) {
        const q = await svc.chain.quoteClaim(h, d.onchainId).catch(() => 0n);
        if (q <= 0n) continue;
        if (dryRun) {
          out.push(`claim ${h.slice(0, 6)} (dry run)`);
          continue;
        }
        try {
          const tx = await svc.chain.claim(h, d.onchainId);
          await record(svc, d.id, 'claim', 'paid', `claimed ${q.toString()} for holder ${h.slice(0, 6)}… after 24 h`, { holder: h, amount: q.toString() }, tx.txHash, false);
          out.push(`claim ${tx.txHash}`);
        } catch (err) {
          log.warn({ err: (err as Error).message, deal: d.id }, 'claim failed');
        }
      }
    }
    const after = await svc.chain.getDeal(d.onchainId).catch(() => null);
    if (after && BigInt(after.claimed_shares) === BigInt(after.funded) && after.state !== 'Closed' && !dryRun) {
      try {
        const tx = await svc.chain.closeDeal(d.onchainId);
        await svc.db.update(deals).set({ status: 'closed', updatedAt: new Date() }).where(eq(deals.id, d.id));
        await record(svc, d.id, 'close_deal', 'paid', 'all shares claimed; deal closed, dust to charity', {}, tx.txHash, false);
        out.push(`close_deal ${tx.txHash}`);
        const owed = await svc.chain.owed();
        if (owed.charity > 0n) {
          const s = await svc.chain.sweepCharity();
          out.push(`sweep_charity ${s.txHash}`);
        }
      } catch (err) {
        log.warn({ err: (err as Error).message, deal: d.id }, 'close failed');
      }
    }
  }
  return out;
}

/** agent_tick job: one deal when given, else every deal that may need the agent. */
export async function agentTick(svc: Services, payload: { reason?: string; dealId?: string }): Promise<unknown> {
  const results: Array<{ dealId: string; outcome: AgentOutcome }> = [];
  if (payload.dealId) results.push({ dealId: payload.dealId, outcome: await runAgentForDeal(svc, payload.dealId) });
  else {
    const candidates = await svc.db.query.deals.findMany({ where: inArray(deals.status, ['funded', 'deposit_paid', 'listed']) });
    for (const d of candidates) results.push({ dealId: d.id, outcome: await runAgentForDeal(svc, d.id) });
  }
  const housekeepingOut = await housekeeping(svc, payload.reason ?? 'tick');
  return { results, housekeeping: housekeepingOut };
}
