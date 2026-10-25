/**
 * Ops and Sharia routes (PLAN 8.1, FLOWS O-1 to O-8, B-1): queue, deal detail with
 * audit, listing, deposit, abort with the O-5 reason list, override, default handling,
 * extension, B/L release, KYC/KYB approvals with the importer faucet grant, agent log,
 * policy editor. Every action writes the audit log.
 */
import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ABORT_REASONS, AbortRequest, AgentLogSchema, ExtendRequest, KycQueueSchema, NoteRequest, OpsActionResponseSchema, OpsDealDetailSchema, OpsQueueItemSchema, OverrideRequest, parseAmount, PolicySchema, PolicyUpdateRequest, RecoveryRequest, type OpsDealDetail, type OpsQueueItem } from '@qafila/shared';
import { requireUser } from '../auth.js';
import { audit, deadJobs, enqueue, savePolicy } from '../db/repo.js';
import { agentActions, auditLog, deals, importers, incidents, policy as policyTable, profiles, reports, suppliers } from '../db/schema.js';
import { ApiError, reply } from '../lib/http.js';
import { abortDeal, listDealOnChain, openIncident, toDetail, toSummary, ONCHAIN_STATUS, type DraftTerms } from '../services/deals.js';
import { runAgentForDeal } from '../jobs/agent.js';
import { documentRecords, findDeal, readJson, type Vars } from './_shared.js';

export const ops = new Hono<{ Variables: Vars }>();

ops.use('*', async (c, next) => {
  requireUser(c, 'ops', 'sharia');
  await next();
});

const ok = (c: Parameters<typeof reply>[0], extra: { txHash?: string | null; txHashes?: Record<string, string> | null; message?: string | null } = {}) => reply(c, OpsActionResponseSchema, { ok: true, txHash: extra.txHash ?? null, txHashes: extra.txHashes ?? null, message: extra.message ?? null });

ops.get('/queue', async (c) => {
  const svc = c.get('svc');
  const rows = await svc.db.query.deals.findMany({ orderBy: desc(deals.updatedAt), limit: 200 });
  const out: OpsQueueItem[] = [];
  for (const d of rows) {
    if (d.status === 'kyb') continue;
    const onchain = d.onchainId ? await svc.chain.getDeal(d.onchainId).catch(() => null) : null;
    const report = d.reportId ? await svc.db.query.reports.findFirst({ where: eq(reports.id, d.blReportId ?? d.reportId), columns: { decision: true, riskScore: true } }) : null;
    const summary = await toSummary(svc, d, onchain, report ?? null, null);
    const importer = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, d.importerId) });
    const importerRow = await svc.db.query.importers.findFirst({ where: eq(importers.profileId, d.importerId) });
    const supplier = d.supplierId ? await svc.db.query.suppliers.findFirst({ where: eq(suppliers.id, d.supplierId) }) : null;
    const open = await svc.db.query.incidents.findMany({ where: and(eq(incidents.dealId, d.id), eq(incidents.status, 'open')) });
    const stage = (onchain ? ONCHAIN_STATUS[onchain.state] : d.status) as OpsQueueItem['stage'];
    const now = Math.floor(Date.now() / 1000);
    const ext = await svc.db.query.extensionRequests.findFirst({ where: (t, { eq: e, and: a }) => a(e(t.dealId, d.id), e(t.status, 'pending')) });
    let pending: OpsQueueItem['pendingAction'] = null;
    if (stage === 'review') pending = 'review_report';
    else if (stage === 'promised' || stage === 'approved') pending = 'list';
    else if (stage === 'funded') pending = 'pay_deposit';
    else if (stage === 'deposit_paid' && d.blReportId) pending = 'confirm_shipment';
    else if (stage === 'sold' && !d.blReleasedAt) pending = 'release_bl';
    else if (stage === 'sold' && onchain && now > onchain.due_at + 60) pending = 'mark_default';
    else if (stage === 'defaulted') pending = 'finalize';
    if (ext) pending = 'extension';
    out.push({ ...summary, importerName: importerRow?.legalName ?? importer?.displayName ?? '', supplierName: supplier?.nameEn ?? '', stage, pendingAction: pending, openIncidents: open.length, updatedAt: d.updatedAt.toISOString() });
  }
  return reply(c, z.array(OpsQueueItemSchema), out);
});

ops.get('/deals/:id', async (c) => {
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  const detail = await toDetail(svc, deal);
  const importer = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, deal.importerId) });
  const importerRow = await svc.db.query.importers.findFirst({ where: eq(importers.profileId, deal.importerId) });
  const stats = importer?.walletAddress ? await svc.chain.importerStats(importer.walletAddress).catch(() => null) : null;
  const limit = importer?.walletAddress ? await svc.chain.importerLimit(importer.walletAddress).catch(() => 0n) : 0n;
  const auditRows = await svc.db.query.auditLog.findMany({ where: eq(auditLog.target, deal.id), orderBy: desc(auditLog.createdAt), limit: 100 });
  const incidentRows = await svc.db.query.incidents.findMany({ where: eq(incidents.dealId, deal.id), orderBy: desc(incidents.createdAt) });
  const actions = await svc.db.query.agentActions.findMany({ where: eq(agentActions.dealId, deal.id), orderBy: desc(agentActions.createdAt), limit: 100 });
  const u = c.get('user')!;
  const { importerDealOf } = await import('./ops-importer.js');
  const imp = await importerDealOf(svc, deal, u);
  const recoveries = detail.payments.filter((p) => p.kind === 'recovery').map((p) => ({ amount: p.amount, from: null, note: auditRows.find((a) => a.action === 'deposit_recovery' && (a.after as { txHash?: string } | null)?.txHash === p.txHash)?.reason ?? '', txHash: p.txHash, at: p.at }));
  const abortRow = auditRows.find((a) => a.action === 'abort_deal');
  const body: OpsDealDetail = {
    ...detail,
    ...imp,
    importer: { displayName: importer?.displayName ?? '', legalName: importerRow?.legalName ?? '', country: importerRow?.country ?? importer?.country ?? '', registrationNumber: importerRow?.registrationNumber ?? '', kybStatus: (importerRow?.kybStatus as OpsDealDetail['importer']['kybStatus']) ?? 'none', walletAddress: (importer?.walletAddress as OpsDealDetail['importer']['walletAddress']) ?? null, stats: stats ?? { on_time: 0, late: 0, defaulted: 0, total_repaid: '0', open_exposure: '0' }, limit: limit.toString() },
    listing: deal.onchainId ? { shareToken: deal.shareToken, issuerPublicKey: deal.issuerPublicKey, txHashes: Object.fromEntries((deal.factoryTxHashes ?? []).map((h, i) => [i === (deal.factoryTxHashes ?? []).length - 1 ? 'list' : `factory_${i + 1}`, h]).filter(([, h]) => /^[0-9a-f]{64}$/.test(String(h)))) } : null,
    audit: auditRows.map((a) => ({ id: a.id, actor: a.actor ?? 'system', action: a.action, reason: a.reason, at: a.createdAt.toISOString(), txHash: ((a.after as { txHash?: string } | null)?.txHash && /^[0-9a-f]{64}$/.test((a.after as { txHash?: string }).txHash!)) ? (a.after as { txHash: string }).txHash : null })),
    incidents: incidentRows.map((i) => ({ id: i.id, dealNumber: deal.number, kind: i.kind, detail: i.detail, status: i.status as 'open' | 'resolved', at: i.createdAt.toISOString() })),
    agentActions: actions.map((a) => ({ id: a.id, dealNumber: deal.number, action: a.action, decision: a.decision, reasoning: a.reasoning, txHash: a.txHash && /^[0-9a-f]{64}$/.test(a.txHash) ? a.txHash : null, status: (a.dryRun ? 'dry_run' : a.status) as 'done' | 'skipped' | 'failed' | 'dry_run', at: a.createdAt.toISOString() })),
    recoveries,
    recoveryNotes: auditRows.filter((a) => a.action === 'recovery_note').map((a) => ({ note: a.reason ?? '', at: a.createdAt.toISOString(), by: a.actor ?? 'ops' })),
    abort: abortRow ? { reason: deal.abortReason ?? 'other', importerAtFault: Boolean((abortRow.after as { importerAtFault?: boolean } | null)?.importerAtFault), note: deal.abortNote ?? abortRow.reason ?? '', at: abortRow.createdAt.toISOString(), txHash: (abortRow.after as { txHash?: string } | null)?.txHash ?? null } : null,
  };
  return reply(c, OpsDealDetailSchema, body);
});

ops.post('/deals/:id/list', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  const r = await listDealOnChain(svc, deal, u.profileId);
  const txHashes: Record<string, string> = {};
  r.factoryTxHashes.forEach((h, i) => (txHashes[`factory_${i + 1}`] = h));
  txHashes['list'] = r.txHash;
  return ok(c, { txHash: r.txHash, txHashes, message: `listed as deal ${r.onchainId}; share token ${r.shareToken}` });
});

ops.post('/deals/:id/pay-deposit', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  if (!deal.onchainId) throw new ApiError(409, 'not_onchain', 'not listed');
  const tx = await svc.chain.paySupplierDeposit(deal.onchainId, 'admin');
  await audit(svc.db, { actor: u.profileId, action: 'pay_supplier_deposit', target: deal.id, after: { txHash: tx.txHash, amount: String(tx.result ?? '') } });
  await svc.db.update(deals).set({ status: 'deposit_paid', updatedAt: new Date() }).where(eq(deals.id, deal.id));
  await enqueue(svc.db, 'notify', { kind: 'deposit_paid', dealId: deal.id, amount: String(tx.result ?? '') });
  return ok(c, { txHash: tx.txHash });
});

ops.post('/deals/:id/confirm-shipment', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  const r = await runAgentForDeal(svc, deal.id, { as: 'admin', actor: u.profileId, force: true });
  if (!r.txHash && r.decision !== 'confirmed') throw new ApiError(409, 'not_confirmed', r.reasoning);
  return ok(c, { txHash: r.txHash, message: r.reasoning });
});

ops.post('/deals/:id/abort', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  const body = await readJson(c, AbortRequest);
  const r = await abortDeal(svc, deal, u.profileId, body.reason, body.importerAtFault, body.note);
  return ok(c, { txHash: r.txHash, message: `${ABORT_REASONS[body.reason].label}; importer at fault: ${r.importerAtFault}; state ${r.state}` });
});

ops.post('/deals/:id/override', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  const body = await readJson(c, OverrideRequest);
  if (!deal.reportId) throw new ApiError(409, 'no_report', 'no report to override');
  const before = deal.status;
  const status = body.decision === 'approve' ? 'approved' : body.decision;
  const terms = { ...((deal.terms ?? {}) as Record<string, unknown>), ops_override: body.decision === 'approve', registry_override: body.decision === 'approve' };
  await svc.db.update(deals).set({ status: deal.onchainId ? deal.status : status, terms, updatedAt: new Date() }).where(eq(deals.id, deal.id));
  await audit(svc.db, { actor: u.profileId, action: 'override_decision', target: deal.id, before: { status: before }, after: { status, decision: body.decision }, reason: body.reason });
  await enqueue(svc.db, 'notify', { kind: 'verification_done', dealId: deal.id, stage: 'listing', decision: body.decision });
  return ok(c, { message: `decision set to ${body.decision}` });
});

ops.post('/deals/:id/default', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  const body = await readJson(c, NoteRequest);
  if (!deal.onchainId) throw new ApiError(409, 'not_onchain', 'not listed');
  const tx = await svc.chain.markDefault(deal.onchainId);
  await svc.db.update(deals).set({ status: 'defaulted', updatedAt: new Date() }).where(eq(deals.id, deal.id));
  await audit(svc.db, { actor: u.profileId, action: 'mark_default', target: deal.id, after: { txHash: tx.txHash }, reason: body.note });
  return ok(c, { txHash: tx.txHash });
});

ops.post('/deals/:id/recovery', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  const body = await readJson(c, RecoveryRequest);
  if (!deal.onchainId) throw new ApiError(409, 'not_onchain', 'not listed');
  const from = body.from ?? svc.env.TREASURY_ADDRESS;
  if (!from) throw new ApiError(422, 'no_source', 'a source account is needed for the recovery');
  const tx = await svc.chain.depositRecovery(deal.onchainId, from, BigInt(body.amount));
  await audit(svc.db, { actor: u.profileId, action: 'deposit_recovery', target: deal.id, after: { txHash: tx.txHash, amount: body.amount, from }, reason: body.note });
  return ok(c, { txHash: tx.txHash });
});

ops.post('/deals/:id/recovery-note', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  const body = await readJson(c, NoteRequest);
  await audit(svc.db, { actor: u.profileId, action: 'recovery_note', target: deal.id, reason: body.note });
  return ok(c);
});

ops.post('/deals/:id/finalize', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  if (!deal.onchainId) throw new ApiError(409, 'not_onchain', 'not listed');
  const tx = await svc.chain.finalizeDefault(deal.onchainId);
  await svc.db.update(deals).set({ status: 'liquidated', updatedAt: new Date() }).where(eq(deals.id, deal.id));
  await audit(svc.db, { actor: u.profileId, action: 'finalize_default', target: deal.id, after: { txHash: tx.txHash } });
  await enqueue(svc.db, 'notify', { kind: 'repaid_claim', dealId: deal.id });
  await enqueue(svc.db, 'agent_tick', { reason: 'finalize', dealId: deal.id }, { dedupeKey: `agent_tick:${deal.id}:finalize` });
  return ok(c, { txHash: tx.txHash });
});

ops.post('/deals/:id/extend', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  if (!svc.env.FF_EXTENSIONS) throw new ApiError(404, 'not_found', 'extensions are off');
  const deal = await findDeal(svc, c.req.param('id'));
  const body = await readJson(c, ExtendRequest);
  if (!deal.onchainId) throw new ApiError(409, 'not_onchain', 'not listed');
  const tx = await svc.chain.extendDue(deal.onchainId, body.newDueAt);
  await svc.db.update(svc.db._.fullSchema.extensionRequests).set({ status: 'granted', decisionNote: body.note, decidedBy: u.profileId, txHash: tx.txHash, decidedAt: new Date() }).where(eq(svc.db._.fullSchema.extensionRequests.dealId, deal.id));
  await audit(svc.db, { actor: u.profileId, action: 'extend_due', target: deal.id, after: { txHash: tx.txHash, newDueAt: body.newDueAt }, reason: body.note });
  await enqueue(svc.db, 'notify', { kind: 'due_extended', dealId: deal.id });
  return ok(c, { txHash: tx.txHash });
});

ops.post('/deals/:id/refuse-extension', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  const body = await readJson(c, NoteRequest);
  await svc.db.update(svc.db._.fullSchema.extensionRequests).set({ status: 'refused', decisionNote: body.note, decidedBy: u.profileId, decidedAt: new Date() }).where(eq(svc.db._.fullSchema.extensionRequests.dealId, deal.id));
  await audit(svc.db, { actor: u.profileId, action: 'refuse_extension', target: deal.id, reason: body.note });
  return ok(c);
});

ops.post('/deals/:id/release-bl', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const deal = await findDeal(svc, c.req.param('id'));
  const body = await readJson(c, NoteRequest);
  await svc.db.update(deals).set({ blReleasedAt: new Date(), blReleaseNote: body.note, updatedAt: new Date() }).where(eq(deals.id, deal.id));
  await audit(svc.db, { actor: u.profileId, action: 'release_bl', target: deal.id, reason: body.note });
  return ok(c, { message: 'B/L release recorded' });
});

ops.post('/incidents/:id/resolve', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const body = await readJson(c, NoteRequest);
  await svc.db.update(incidents).set({ status: 'resolved', resolvedAt: new Date() }).where(eq(incidents.id, c.req.param('id')));
  await audit(svc.db, { actor: u.profileId, action: 'resolve_incident', target: c.req.param('id'), reason: body.note });
  return ok(c);
});

// ---------------------------------------------------------------- KYC and KYB

ops.get('/kyc', async (c) => {
  const svc = c.get('svc');
  const pendingInvestors = await svc.db.query.profiles.findMany({ where: eq(profiles.kycStatus, 'pending'), orderBy: desc(profiles.createdAt), limit: 200 });
  const kyb = await svc.db.query.importers.findMany({ orderBy: desc(importers.createdAt), limit: 200 });
  const out = [];
  for (const p of pendingInvestors) out.push({ id: p.id, kind: 'investor' as const, displayName: p.displayName, country: p.country ?? '', walletAddress: p.walletAddress as `G${string}` | null, legalName: null, registrationNumber: null, documents: [], submittedAt: p.createdAt.toISOString(), status: p.kycStatus as 'pending' });
  for (const i of kyb) {
    const p = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, i.profileId) });
    const kybDeal = await svc.db.query.deals.findFirst({ where: and(eq(deals.importerId, i.profileId), eq(deals.status, 'kyb')) });
    out.push({ id: i.profileId, kind: 'importer' as const, displayName: p?.displayName ?? '', country: i.country, walletAddress: (p?.walletAddress as `G${string}` | null) ?? null, legalName: i.legalName, registrationNumber: i.registrationNumber, documents: kybDeal ? await documentRecords(svc, kybDeal.id, true) : [], submittedAt: i.createdAt.toISOString(), status: i.kybStatus as 'pending' | 'approved' | 'rejected' });
  }
  return reply(c, KycQueueSchema, out);
});

/** Approves an investor (approve_investor) or an importer's KYB (role, faucet grant of 1.35 x limit). */
ops.post('/kyc/:id/approve', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user')!;
  const profileId = c.req.param('id');
  const p = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, profileId) });
  if (!p) throw new ApiError(404, 'not_found', 'profile not found');
  const imp = await svc.db.query.importers.findFirst({ where: eq(importers.profileId, profileId) });
  let txHash: string | null = null;
  let message = '';
  if (imp && imp.kybStatus !== 'approved') {
    await svc.db.update(importers).set({ kybStatus: 'approved' }).where(eq(importers.profileId, profileId));
    await svc.db.update(profiles).set({ roles: [...new Set([...p.roles, 'importer'])] }).where(eq(profiles.id, profileId));
    message = 'KYB approved';
    if (p.walletAddress && svc.env.STELLAR_NETWORK !== 'mainnet' && !imp.faucetGrantTx) {
      const limit = await svc.chain.importerLimit(p.walletAddress).catch(() => parseAmount(svc.env.BASE_IMPORTER_LIMIT));
      const base = limit > 0n ? limit : parseAmount(svc.env.BASE_IMPORTER_LIMIT);
      const grant = (base * 135n) / 100n;
      try {
        const tx = await svc.chain.faucet(p.walletAddress, grant);
        txHash = tx.txHash;
        await svc.db.update(importers).set({ faucetGrantTx: tx.txHash, documents: [...(imp.documents ?? []), { documentId: 'faucet', type: 'faucet' }] }).where(eq(importers.profileId, profileId));
        message += `; faucet grant ${grant.toString()} stroops (1.35 x limit)`;
      } catch (e) {
        await enqueue(svc.db, 'faucet_grant', { profileId, walletAddress: p.walletAddress, amount: grant.toString(), kyb: true }, { dedupeKey: `faucet:${p.walletAddress}:${grant}` });
        message += `; faucet grant queued (${(e as Error).message.slice(0, 80)})`;
      }
    }
  } else if (p.walletAddress) {
    const tx = await svc.chain.approveInvestor(p.walletAddress);
    txHash = tx.txHash;
    await svc.db.update(profiles).set({ kycStatus: 'approved', kycApprovedTx: tx.txHash }).where(eq(profiles.id, profileId));
    message = 'investor approved on-chain';
  } else throw new ApiError(409, 'no_wallet', 'the profile has no wallet to approve');
  await audit(svc.db, { actor: u.profileId, action: 'kyc_approve', target: profileId, after: { txHash, message } });
  return ok(c, { txHash, message });
});

// ---------------------------------------------------------------- agent log and policy

ops.get('/agent', async (c) => {
  const svc = c.get('svc');
  const actions = await svc.db.query.agentActions.findMany({ orderBy: desc(agentActions.createdAt), limit: 100 });
  const inc = await svc.db.query.incidents.findMany({ orderBy: desc(incidents.createdAt), limit: 100 });
  const dealNumbers = new Map<string, number>();
  const ids = [...new Set([...actions.map((a) => a.dealId), ...inc.map((i) => i.dealId)].filter((x): x is string => Boolean(x)))];
  if (ids.length) for (const d of await svc.db.query.deals.findMany({ where: inArray(deals.id, ids), columns: { id: true, number: true } })) dealNumbers.set(d.id, d.number);
  const dead = await deadJobs(svc.db);
  const agentAddress = (svc.env.AGENT_SMART_ACCOUNT_ID ?? (await import('../env.js')).loadDeployment(svc.env.STELLAR_NETWORK).agent ?? null) as `G${string}` | `C${string}` | null;
  return reply(c, AgentLogSchema, {
    actions: actions.map((a) => ({ id: a.id, dealNumber: a.dealId ? (dealNumbers.get(a.dealId) ?? null) : null, action: a.action, decision: a.decision, reasoning: a.reasoning, txHash: a.txHash && /^[0-9a-f]{64}$/.test(a.txHash) ? a.txHash : null, status: (a.dryRun ? 'dry_run' : a.status) as 'done' | 'skipped' | 'failed' | 'dry_run', at: a.createdAt.toISOString() })),
    incidents: inc.map((i) => ({ id: i.id, dealNumber: i.dealId ? (dealNumbers.get(i.dealId) ?? null) : null, kind: i.kind, detail: i.detail, status: i.status as 'open' | 'resolved', at: i.createdAt.toISOString() })),
    deadJobs: dead.map((j) => ({ id: j.id, kind: j.kind, lastError: j.lastError, attempts: j.attempts })),
    agentAddress,
    mode: svc.env.AGENT_DRY_RUN ? 'dry_run' : svc.chain.mode === 'mock' || svc.env.AGENT_SIGNER_SECRET ? 'live' : 'off',
  });
});

ops.get('/policy', async (c) => {
  const svc = c.get('svc');
  const p = await svc.policy();
  const row = await svc.db.query.policy.findFirst({ orderBy: desc(policyTable.version) });
  return reply(c, PolicySchema, { version: p.version, categories: p.categories.map((x) => ({ name: x.id, verdict: x.verdict, note: `${x.label}. ${x.description}` })), thresholds: p.thresholds, updatedBy: row?.updatedBy ?? null, updatedAt: (row?.createdAt ?? new Date()).toISOString() });
});

ops.put('/policy', async (c) => {
  const svc = c.get('svc');
  const u = requireUser(c, 'sharia', 'ops');
  const body = await readJson(c, PolicyUpdateRequest);
  const current = await svc.policy();
  const categories = body.categories.map((x) => {
    const existing = current.categories.find((e) => e.id === x.name);
    const [label, ...rest] = x.note.split('. ');
    return { id: x.name, label: existing?.label ?? label ?? x.name, verdict: x.verdict, description: existing && x.note === `${existing.label}. ${existing.description}` ? existing.description : rest.join('. ') || x.note };
  });
  if (!categories.some((x) => x.id === 'unclassified')) categories.push({ id: 'unclassified', label: 'Nothing in the policy fits', verdict: 'review', description: 'A person decides' });
  const saved = await savePolicy(svc.db, { categories, thresholds: body.thresholds }, u.profileId);
  await audit(svc.db, { actor: u.profileId, action: 'policy_update', target: `policy:${saved.version}`, before: { version: current.version }, after: { version: saved.version } });
  return reply(c, PolicySchema, { version: saved.version, categories: saved.categories.map((x) => ({ name: x.id, verdict: x.verdict, note: `${x.label}. ${x.description}` })), thresholds: saved.thresholds, updatedBy: u.profileId, updatedAt: new Date().toISOString() });
});

ops.post('/deals/:id/incident', async (c) => {
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  const body = await readJson(c, z.object({ kind: z.string().min(2), detail: z.string().min(3) }));
  await openIncident(svc.db, deal.id, body.kind, body.detail);
  return ok(c);
});

export type { DraftTerms };
