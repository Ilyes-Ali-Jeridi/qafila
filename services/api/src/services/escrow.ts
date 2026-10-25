/**
 * S2 Trustless Work escrow (PLAN 10.1, FLOWS 5.2). The deal contract stays escrow-agnostic: at
 * listing the API deploys a two-milestone escrow (deposit, balance) and sets `terms.supplier` to
 * the escrow address, so `pay_supplier_deposit` and `confirm_shipment` fund it by plain transfer.
 * After each payment the agent approves and releases the matching milestone to the supplier.
 * Disputes: the agent (approver) raises one, the resolver sends the milestone back to a Qafila
 * account, ops records it in the deal with `deposit_recovery`.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { eq } from 'drizzle-orm';
import type { DealEscrow } from '@qafila/shared';
import { escrowPlan, TrustlessWorkError, type EscrowPlan, type TrustlessWorkClient } from '../adapters/trustlesswork.js';
import { audit } from '../db/repo.js';
import { agentActions, deals } from '../db/schema.js';
import { loadDeployment } from '../env.js';
import { ApiError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import type { Services } from '../services.js';
import { openIncident, type DealRow, type DraftTerms } from './deals.js';

const log = logger.child({ module: 'escrow' });

/** What the deal row keeps about its escrow (`deals.terms.escrow`). */
export interface EscrowTerms {
  id: string;
  feeBps: number;
  fee: string;
  invoiceCost: string;
  grossCost: string;
  deposit: string;
  balance: string;
  deployTxHash: string | null;
  mode: 'live' | 'mock';
  roles: { approver: string; serviceProvider: string; platformAddress: string; releaseSigner: string; disputeResolver: string };
}

export type TermsWithEscrow = Partial<DraftTerms> & { escrow?: EscrowTerms };

export function escrowClient(svc: Services): TrustlessWorkClient | null {
  return svc.env.FF_TRUSTLESS_WORK ? svc.adapters.trustlesswork : null;
}

export interface EscrowKeys {
  admin: Keypair;
  agent: Keypair;
  platform: string;
  resolver: string;
}

/** Signing keys for the escrow roles. Mock chain without secrets uses fixed test keys (never on a live chain). */
export function escrowKeys(svc: Services): EscrowKeys {
  const mock = svc.chain.mode === 'mock';
  const kp = (secret: string | undefined, seed: number, name: string): Keypair => {
    if (secret) return Keypair.fromSecret(secret);
    if (mock) return Keypair.fromRawEd25519Seed(Buffer.alloc(32, seed));
    throw new ApiError(503, 'no_key', `${name} is missing; the escrow roles cannot sign`);
  };
  const admin = kp(svc.env.ADMIN_SECRET, 11, 'ADMIN_SECRET');
  const agent = kp(svc.env.AGENT_SIGNER_SECRET, 12, 'AGENT_SIGNER_SECRET');
  return { admin, agent, platform: svc.env.TRUSTLESS_WORK_PLATFORM_ADDRESS ?? admin.publicKey(), resolver: svc.env.TRUSTLESS_WORK_DISPUTE_RESOLVER ?? admin.publicKey() };
}

export function settlementAsset(svc: Services): { issuer: string; code: string } {
  const dep = loadDeployment(svc.env.STELLAR_NETWORK);
  const issuer = svc.env.SETTLEMENT_TOKEN_ISSUER ?? dep.settlementToken?.issuer;
  if (!issuer) {
    if (svc.chain.mode === 'mock') return { issuer: 'GDZE4PY2VVPCOTERMIETEB73XA5KDHI25ZGDAINMCTEXYBJCG76H63VA', code: svc.env.SETTLEMENT_TOKEN_CODE };
    throw new ApiError(503, 'no_settlement_token', 'SETTLEMENT_TOKEN_ISSUER is not configured');
  }
  return { issuer, code: svc.env.SETTLEMENT_TOKEN_CODE ?? dep.settlementToken?.code ?? 'qUSD' };
}

export function escrowTermsOf(deal: DealRow): EscrowTerms | null {
  const t = (deal.terms ?? {}) as TermsWithEscrow;
  return t.escrow && deal.escrowId === t.escrow.id ? t.escrow : null;
}

export function planOf(terms: EscrowTerms): EscrowPlan {
  return { grossCost: BigInt(terms.grossCost), deposit: BigInt(terms.deposit), balance: BigInt(terms.balance), fee: BigInt(terms.fee), feeBps: terms.feeBps, invoiceCost: BigInt(terms.invoiceCost), supplierNet: 0n };
}

/**
 * Deploys the deal's escrow (idempotent: a deal that already has one keeps it), persists the
 * escrow id, the payment mode and the fee terms, and returns what `list_deal` needs.
 */
export async function deployDealEscrow(svc: Services, deal: DealRow, args: { supplier: string; depositBps: number; invoiceCost: bigint; actor: string | null }): Promise<{ escrowId: string; plan: EscrowPlan; terms: EscrowTerms }> {
  const tw = escrowClient(svc);
  if (!tw) throw new ApiError(503, 'escrow_off', 'FF_TRUSTLESS_WORK is off or the adapter is not configured');
  const existing = escrowTermsOf(deal);
  if (existing) {
    log.info({ deal: deal.id, escrow: existing.id }, 'reusing the escrow from an earlier listing attempt');
    return { escrowId: existing.id, plan: escrowPlan(BigInt(existing.invoiceCost), args.depositBps, existing.feeBps), terms: existing };
  }
  const keys = escrowKeys(svc);
  const plan = escrowPlan(args.invoiceCost, args.depositBps, tw.feeBps);
  if (plan.deposit <= 0n || plan.balance <= 0n) throw new ApiError(422, 'escrow_amounts', 'both escrow milestones need a positive amount');
  const roles = { approver: keys.agent.publicKey(), serviceProvider: args.supplier, platformAddress: keys.platform, releaseSigner: keys.agent.publicKey(), disputeResolver: keys.resolver };
  const deployed = await tw.deploy({
    signer: keys.admin,
    engagementId: `qafila-deal-${deal.number}-${deal.id.slice(0, 8)}`,
    title: `Qafila deal ${deal.number}: supplier payment`,
    description: `Murabaha purchase of ${deal.goodsSummary.slice(0, 120)}: ${args.depositBps / 100}% deposit at order, balance on shipment. Funded by the Qafila deal contract.`,
    roles,
    milestones: [
      { description: 'Supplier deposit at order', amount: plan.deposit, receiver: args.supplier },
      { description: 'Balance on shipment (bill of lading verified)', amount: plan.balance, receiver: args.supplier },
    ],
    asset: settlementAsset(svc),
  });
  const terms: EscrowTerms = { id: deployed.escrowId, feeBps: plan.feeBps, fee: plan.fee.toString(), invoiceCost: plan.invoiceCost.toString(), grossCost: plan.grossCost.toString(), deposit: plan.deposit.toString(), balance: plan.balance.toString(), deployTxHash: deployed.txHash, mode: deployed.mode, roles };
  const current = (deal.terms ?? {}) as TermsWithEscrow;
  await svc.db.update(deals).set({ escrowId: deployed.escrowId, paymentMode: 'TrustlessWork', terms: { ...current, escrow: terms }, updatedAt: new Date() }).where(eq(deals.id, deal.id));
  await audit(svc.db, { actor: args.actor, action: 'escrow_deployed', target: deal.id, after: { escrowId: deployed.escrowId, txHash: deployed.txHash, feeBps: plan.feeBps, fee: plan.fee.toString(), grossCost: plan.grossCost.toString(), mode: deployed.mode } });
  log.info({ deal: deal.id, escrow: deployed.escrowId, mode: deployed.mode, fee: plan.fee.toString() }, deployed.mode === 'mock' ? 'escrow deployed (MOCK)' : 'escrow deployed');
  return { escrowId: deployed.escrowId, plan, terms };
}

export interface EscrowReleaseOutcome {
  decision: 'paid' | 'failed' | 'dry_run' | 'noop';
  txHash: string | null;
  approveTxHash: string | null;
  reasoning: string;
}

async function recordAction(svc: Services, dealId: string, action: string, decision: EscrowReleaseOutcome['decision'], reasoning: string, inputs: unknown, txHash: string | null, dryRun: boolean): Promise<void> {
  await svc.db.insert(agentActions).values({ dealId, action, decision, reasoning, inputs: inputs as object, txHash, status: decision === 'failed' ? 'failed' : decision === 'noop' ? 'skipped' : 'done', dryRun });
}

/**
 * After the deal contract has paid milestone `index` into the escrow, the agent approves and
 * releases it to the supplier. Failures never block the deal: the funds stay in the escrow and
 * an incident asks ops to act (release again, or dispute and recover).
 */
export async function releaseEscrowMilestone(svc: Services, deal: DealRow, index: 0 | 1, opts: { dryRun: boolean; trigger: string }): Promise<EscrowReleaseOutcome> {
  const tw = escrowClient(svc);
  const terms = escrowTermsOf(deal);
  if (deal.paymentMode !== 'TrustlessWork' || !deal.escrowId) return { decision: 'noop', txHash: null, approveTxHash: null, reasoning: 'native payment mode' };
  const action = `escrow_release_${index + 1}`;
  if (!tw) {
    await openIncident(svc.db, deal.id, 'escrow_release_blocked', `Milestone ${index + 1} of escrow ${deal.escrowId} is funded but FF_TRUSTLESS_WORK is off, so the agent cannot release it.`);
    return { decision: 'failed', txHash: null, approveTxHash: null, reasoning: 'FF_TRUSTLESS_WORK is off' };
  }
  const amount = terms ? (index === 0 ? terms.deposit : terms.balance) : null;
  const inputs = { escrowId: deal.escrowId, milestone: index, amount, trigger: opts.trigger };
  if (opts.dryRun) {
    await recordAction(svc, deal.id, action, 'dry_run', `would approve and release milestone ${index + 1} (${amount ?? '?'}) to the supplier`, inputs, null, true);
    return { decision: 'dry_run', txHash: null, approveTxHash: null, reasoning: 'dry run' };
  }
  const keys = escrowKeys(svc);
  try {
    if (tw.mockFund && amount) tw.mockFund(deal.escrowId, BigInt(amount)); // mock mirror of the contract's transfer
    let approveTxHash: string | null = null;
    const state = await tw.getEscrow(deal.escrowId);
    const ms = state?.milestones[index];
    if (ms?.released) {
      await recordAction(svc, deal.id, action, 'noop', `milestone ${index + 1} was already released`, inputs, null, false);
      return { decision: 'noop', txHash: null, approveTxHash: null, reasoning: 'already released' };
    }
    if (!ms?.approved) {
      try {
        approveTxHash = (await tw.approveMilestone(deal.escrowId, index, keys.agent)).txHash;
      } catch (e) {
        // The indexer can lag the chain by a few seconds (SP10): an approval that already landed is fine.
        if (!(e instanceof TrustlessWorkError && /already been approved/i.test(e.message))) throw e;
      }
    }
    const released = await tw.releaseMilestone(deal.escrowId, index, keys.agent);
    const reasoning = `Agent approved and released escrow milestone ${index + 1} (${amount ?? 'amount on-chain'}) to the supplier after ${opts.trigger}; Trustless Work keeps ${terms?.feeBps ?? tw.feeBps} bps.`;
    await recordAction(svc, deal.id, action, 'paid', reasoning, { ...inputs, approveTxHash }, released.txHash, false);
    return { decision: 'paid', txHash: released.txHash, approveTxHash, reasoning };
  } catch (e) {
    const msg = e instanceof TrustlessWorkError ? `${e.code}: ${e.message}` : (e as Error).message;
    await openIncident(svc.db, deal.id, 'escrow_release_blocked', `The agent could not release milestone ${index + 1} of escrow ${deal.escrowId}: ${msg.slice(0, 400)}. The funds are in the escrow; release again or dispute and recover.`);
    await recordAction(svc, deal.id, action, 'failed', msg.slice(0, 300), inputs, null, false);
    return { decision: 'failed', txHash: null, approveTxHash: null, reasoning: msg.slice(0, 300) };
  }
}

/** Ops: the agent (approver) raises a dispute on a funded, unreleased milestone (FLOWS 5.2). */
export async function disputeEscrowMilestone(svc: Services, deal: DealRow, index: 0 | 1, actor: string | null, note: string): Promise<{ txHash: string }> {
  const tw = escrowClient(svc);
  if (!tw) throw new ApiError(503, 'escrow_off', 'FF_TRUSTLESS_WORK is off');
  if (deal.paymentMode !== 'TrustlessWork' || !deal.escrowId) throw new ApiError(409, 'no_escrow', 'this deal has no escrow');
  const keys = escrowKeys(svc);
  try {
    const r = await tw.disputeMilestone(deal.escrowId, index, keys.agent);
    await audit(svc.db, { actor, action: 'escrow_dispute', target: deal.id, after: { escrowId: deal.escrowId, milestone: index, txHash: r.txHash }, reason: note });
    return { txHash: r.txHash };
  } catch (e) {
    if (e instanceof TrustlessWorkError) throw new ApiError(409, `escrow_${e.code}`, e.message);
    throw e;
  }
}

/** Ops: the dispute resolver sends `amount` of the disputed milestone back to `refundTo` (default: the admin account), to be recorded with `deposit_recovery`. */
export async function resolveEscrowMilestone(svc: Services, deal: DealRow, index: 0 | 1, amount: bigint, refundTo: string | undefined, actor: string | null, note: string): Promise<{ txHash: string; refundTo: string }> {
  const tw = escrowClient(svc);
  if (!tw) throw new ApiError(503, 'escrow_off', 'FF_TRUSTLESS_WORK is off');
  if (deal.paymentMode !== 'TrustlessWork' || !deal.escrowId) throw new ApiError(409, 'no_escrow', 'this deal has no escrow');
  if (amount <= 0n) throw new ApiError(422, 'amount', 'the refund must be positive');
  const keys = escrowKeys(svc);
  const to = refundTo ?? keys.admin.publicKey();
  try {
    const r = await tw.resolveMilestoneDispute(deal.escrowId, index, keys.admin, [{ address: to, amount }]);
    await audit(svc.db, { actor, action: 'escrow_resolve', target: deal.id, after: { escrowId: deal.escrowId, milestone: index, txHash: r.txHash, amount: amount.toString(), refundTo: to }, reason: note });
    return { txHash: r.txHash, refundTo: to };
  } catch (e) {
    if (e instanceof TrustlessWorkError) throw new ApiError(409, `escrow_${e.code}`, e.message);
    throw e;
  }
}

/** The escrow block of `GET /deals/:id`; null unless the deal pays through Trustless Work. */
export async function escrowDetail(svc: Services, deal: DealRow): Promise<DealEscrow | null> {
  if (deal.paymentMode !== 'TrustlessWork' || !deal.escrowId) return null;
  const terms = escrowTermsOf(deal);
  const tw = svc.adapters.trustlesswork;
  const state = tw ? await tw.getEscrow(deal.escrowId).catch(() => null) : null;
  const url = `${svc.env.TRUSTLESS_WORK_VIEWER_URL.replace(/\/$/, '')}/escrow/${deal.escrowId}`;
  const draft = (deal.terms ?? {}) as TermsWithEscrow;
  return {
    provider: 'trustless_work',
    id: deal.escrowId,
    fundingAddress: deal.escrowId,
    feeBps: terms?.feeBps ?? svc.env.TRUSTLESS_WORK_FEE_BPS,
    fee: terms?.fee ?? '0',
    invoiceCost: terms?.invoiceCost ?? draft.cost ?? '0',
    grossCost: terms?.grossCost ?? draft.cost ?? '0',
    url,
    milestones: state ? state.milestones.map((m) => ({ index: m.index, description: m.description, amount: m.amount.toString(), receiver: m.receiver, status: m.status, approved: m.approved, released: m.released, disputed: m.disputed, resolved: m.resolved })) : [],
    roles: state?.roles ?? terms?.roles ?? null,
    mode: terms?.mode ?? (tw?.mode ?? 'live'),
  };
}
