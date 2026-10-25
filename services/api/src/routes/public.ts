/** Public routes: stats, live event feed, charity ledger, job status, local file serving, supplier confirmation. */
import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CharityLedgerSchema, DEAL_STATES, EventFeedSchema, JobStatusSchema, PurchaseOrderSchema, StatsSchema, formatAmount, type CharityLedger, type EventFeedItem } from '@qafila/shared';
import { Keypair } from '@stellar/stellar-sdk';
import { deals, jobs, onchainEvents, profiles, supplierConfirmations, suppliers } from '../db/schema.js';
import { ApiError, reply } from '../lib/http.js';
import { verifyLocalToken } from '../adapters/storage.js';
import { purchaseOrderOf } from './deals.js';
import { findDeal, readJson, type Vars } from './_shared.js';
import { audit, enqueue } from '../db/repo.js';

export const publicRoutes = new Hono<{ Variables: Vars }>();

publicRoutes.get('/stats', async (c) => {
  const svc = c.get('svc');
  const env = c.get('env');
  const rows = await svc.db.query.deals.findMany({ columns: { id: true, onchainId: true, status: true, security: true } });
  const byState: Record<(typeof DEAL_STATES)[number], number> = Object.fromEntries(DEAL_STATES.map((s) => [s, 0])) as Record<(typeof DEAL_STATES)[number], number>;
  let funded = 0n;
  let profitPaid = 0n;
  let securityLocked = 0n;
  for (const d of rows) {
    if (!d.onchainId) continue;
    const on = await svc.chain.getDeal(d.onchainId).catch(() => null);
    if (!on) continue;
    byState[on.state] += 1;
    funded += BigInt(on.funded);
    securityLocked += BigInt(on.security);
    if (on.state === 'Repaid' || on.state === 'Closed') {
      const profit = BigInt(on.paid_out) - (BigInt(on.claimed_shares) || 0n);
      if (profit > 0n) profitPaid += profit;
    }
  }
  const owed = await svc.chain.owed().catch(() => ({ charity: 0n, treasury: 0n, refunds: 0n, promisesHeld: 0n }));
  securityLocked += owed.promisesHeld;
  const sweeps = await svc.db.query.onchainEvents.findMany({ where: eq(onchainEvents.eventType, 'swept') });
  const charitySwept = sweeps.filter((e) => (e.data as Record<string, unknown>)['to'] === 'charity' || (e.data as Record<string, unknown>)['to'] === env.CHARITY_ADDRESS).reduce((s, e) => s + BigInt(String((e.data as Record<string, unknown>)['amount'] ?? '0')), 0n);
  const refunds = await svc.db.query.onchainEvents.findMany({ where: eq(onchainEvents.eventType, 'refunded') });
  const refundsPaid = refunds.reduce((s, e) => s + BigInt(String((e.data as Record<string, unknown>)['amount'] ?? '0')), 0n);
  const wallets = (await svc.db.select({ n: sql<number>`count(*)::int` }).from(profiles).where(sql`${profiles.walletAddress} is not null`))[0]?.n ?? 0;
  const approved = (await svc.db.select({ n: sql<number>`count(*)::int` }).from(profiles).where(eq(profiles.kycStatus, 'approved')))[0]?.n ?? 0;
  const joined = (await svc.db.select({ n: sql<number>`count(*)::int` }).from(profiles).where(eq(profiles.joinedVia, 'hackmeridian')))[0]?.n ?? 0;
  return reply(c, StatsSchema, { walletsCreated: wallets ?? 0, approvedInvestors: approved ?? 0, dealsByState: byState, funded: funded.toString(), profitPaid: profitPaid.toString(), charityTotal: (charitySwept + owed.charity).toString(), securityLocked: securityLocked.toString(), refundsPaid: refundsPaid.toString(), joinedDuringEvent: joined ?? 0, updatedAt: new Date().toISOString() });
});

function summarise(type: string, data: Record<string, unknown>, dealNumber: number | null, code: string): string {
  const amt = (k: string) => (typeof data[k] === 'string' && /^\d+$/.test(data[k] as string) ? formatAmount(data[k] as string, code) : null);
  const d = dealNumber !== null ? `deal ${dealNumber}` : 'a deal';
  switch (type) {
    case 'deal_listed':
      return `${d} listed for funding`;
    case 'invested':
      return `${amt('amount') ?? 'an investment'} invested in ${d}`;
    case 'funded':
      return `${d} fully funded`;
    case 'deposit_paid':
      return `supplier deposit ${amt('amount') ?? ''} paid for ${d}`.replace(/\s+/g, ' ');
    case 'shipment_confirmed':
      return `shipment confirmed for ${d}; balance ${amt('balance') ?? ''} paid to the supplier`.replace(/\s+/g, ' ');
    case 'murabaha_accepted':
      return `importer signed the sale of ${d}`;
    case 'repaid':
      return `${amt('amount') ?? 'a payment'} repaid on ${d}`;
    case 'late_fee_to_charity':
      return `late fee ${amt('amount') ?? ''} on ${d} goes to charity`.replace(/\s+/g, ' ');
    case 'claimed':
      return `${amt('payout') ?? 'a payout'} claimed from ${d}`;
    case 'promised':
      return `purchase promise signed, security deposit ${amt('security') ?? ''} locked`.replace(/\s+/g, ' ');
    case 'refund_owed':
      return `refund ${amt('amount') ?? ''} owed to the importer of ${d}`.replace(/\s+/g, ' ');
    case 'refunded':
      return `refund ${amt('amount') ?? ''} paid`.replace(/\s+/g, ' ');
    case 'security_applied':
      return `security deposit counted as the first payment on ${d}`;
    case 'swept':
      return `${amt('amount') ?? ''} swept to ${String(data['to'] ?? 'the recipient')}`.replace(/\s+/g, ' ');
    case 'closed':
      return `${d} closed`;
    case 'cancelled':
      return `${d} cancelled, everyone refunded`;
    case 'aborted':
      return `${d} stopped by ops`;
    case 'due_extended':
      return `${d} given more time, price unchanged`;
    case 'investor_approved':
      return 'a new investor approved';
    case 'investor_set':
      return data['approved'] === false ? 'an investor approval revoked' : 'a new investor approved on-chain';
    case 'role_set':
      return `contract role ${String(data['role'] ?? '')} set`;
    case 'upgraded':
      return 'contract upgraded';
    default:
      return `${type.replace(/_/g, ' ')} on ${d}`;
  }
}

publicRoutes.get('/events', async (c) => {
  const svc = c.get('svc');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '20') || 20));
  const rows = await svc.db.query.onchainEvents.findMany({ where: sql`${onchainEvents.contractId} <> 'faucet'`, orderBy: [desc(onchainEvents.ledger), desc(onchainEvents.eventIndex)], limit });
  const out: EventFeedItem[] = [];
  for (const e of rows) {
    const deal = e.dealOnchainId !== null ? await svc.db.query.deals.findFirst({ where: eq(deals.onchainId, e.dealOnchainId), columns: { id: true, number: true } }) : null;
    out.push({ txHash: e.txHash, ledger: e.ledger, type: e.eventType, data: e.data as Record<string, unknown>, at: (e.ledgerClosedAt ?? e.createdAt).toISOString(), dealNumber: deal?.number ?? null, dealId: deal?.id ?? null, summary: summarise(e.eventType, e.data as Record<string, unknown>, deal?.number ?? null, svc.env.SETTLEMENT_TOKEN_CODE) });
  }
  return reply(c, EventFeedSchema, out);
});

publicRoutes.get('/charity', async (c) => {
  const svc = c.get('svc');
  const env = c.get('env');
  const rows = await svc.db.query.onchainEvents.findMany({ orderBy: [desc(onchainEvents.ledger)], limit: 500 });
  const entries: CharityLedger['entries'] = [];
  let total = 0n;
  for (const e of rows) {
    const data = e.data as Record<string, unknown>;
    const deal = e.dealOnchainId !== null ? await svc.db.query.deals.findFirst({ where: eq(deals.onchainId, e.dealOnchainId), columns: { number: true } }) : null;
    const amount = String(data['amount'] ?? data['dust'] ?? '0');
    if (!/^\d+$/.test(amount) || !/^[0-9a-f]{64}$/.test(e.txHash)) continue;
    if (e.eventType === 'late_fee_to_charity') entries.push({ kind: 'late_fee', amount, txHash: e.txHash, dealNumber: deal?.number ?? null, at: (e.ledgerClosedAt ?? e.createdAt).toISOString() });
    else if (e.eventType === 'closed' && BigInt(amount) > 0n) entries.push({ kind: 'dust', amount, txHash: e.txHash, dealNumber: deal?.number ?? null, at: (e.ledgerClosedAt ?? e.createdAt).toISOString() });
    else if (e.eventType === 'swept' && (data['to'] === 'charity' || data['to'] === env.CHARITY_ADDRESS)) {
      entries.push({ kind: 'sweep', amount, txHash: e.txHash, dealNumber: null, at: (e.ledgerClosedAt ?? e.createdAt).toISOString() });
      total += BigInt(amount);
    }
  }
  const owed = await svc.chain.owed().catch(() => ({ charity: 0n }));
  return reply(c, CharityLedgerSchema, { address: (env.CHARITY_ADDRESS as CharityLedger['address']) ?? null, total: total.toString(), owed: owed.charity.toString(), entries });
});

publicRoutes.get('/jobs/:id', async (c) => {
  const svc = c.get('svc');
  const j = await svc.db.query.jobs.findFirst({ where: eq(jobs.id, c.req.param('id')) });
  if (!j) throw new ApiError(404, 'not_found', 'job not found');
  return reply(c, JobStatusSchema, { id: j.id, kind: j.kind, status: j.status as 'queued' | 'running' | 'done' | 'failed' | 'dead', attempts: j.attempts, lastError: j.lastError, result: j.result });
});

/** Local-storage "signed URLs" (mock mode and development). */
publicRoutes.get('/files/*', async (c) => {
  const svc = c.get('svc');
  const env = c.get('env');
  if (svc.adapters.storage.mode !== 'local') throw new ApiError(404, 'not_found', 'files are served by Supabase Storage');
  const path = decodeURIComponent(c.req.path.replace(/^\/files\//, ''));
  const exp = Number(c.req.query('exp') ?? '0');
  const token = c.req.query('token') ?? '';
  if (!verifyLocalToken(env.JWT_SECRET ?? 'dev-local-storage-secret', path, exp, token)) throw new ApiError(403, 'forbidden', 'link expired or invalid');
  const bytes = await svc.adapters.storage.get(path);
  const mime = path.endsWith('.pdf') ? 'application/pdf' : path.endsWith('.png') ? 'image/png' : path.endsWith('.json') ? 'application/json' : 'image/jpeg';
  return new Response(new Blob([bytes as BlobPart]), { headers: { 'content-type': mime, 'cache-control': 'private, max-age=300' } });
});

// ---------------------------------------------------------------- supplier purchase-order confirmation (S-1, S-2; FF_SUPPLIER_CONFIRM)

const ConfirmRequest = z.object({ payoutAddress: z.string().regex(/^[GC][A-Z2-7]{55}$/), accept: z.literal(true), signature: z.string().optional(), message: z.string().optional() });

publicRoutes.get('/supplier/confirm/:token', async (c) => {
  const svc = c.get('svc');
  if (!svc.env.FF_SUPPLIER_CONFIRM) throw new ApiError(404, 'not_found', 'supplier confirmation is off');
  const row = await svc.db.query.supplierConfirmations.findFirst({ where: eq(supplierConfirmations.token, c.req.param('token')) });
  if (!row || row.expiresAt < new Date()) throw new ApiError(404, 'not_found', 'link expired');
  const deal = await findDeal(svc, row.dealId);
  return reply(c, PurchaseOrderSchema, await purchaseOrderOf(svc, deal));
});

publicRoutes.post('/supplier/confirm/:token', async (c) => {
  const svc = c.get('svc');
  if (!svc.env.FF_SUPPLIER_CONFIRM) throw new ApiError(404, 'not_found', 'supplier confirmation is off');
  const row = await svc.db.query.supplierConfirmations.findFirst({ where: and(eq(supplierConfirmations.token, c.req.param('token'))) });
  if (!row || row.expiresAt < new Date()) throw new ApiError(404, 'not_found', 'link expired');
  const body = await readJson(c, ConfirmRequest);
  const deal = await findDeal(svc, row.dealId);
  let signatureOk: boolean | null = null;
  if (body.signature && body.message && body.payoutAddress.startsWith('G')) {
    try {
      signatureOk = Keypair.fromPublicKey(body.payoutAddress).verify(Buffer.from(body.message), Buffer.from(body.signature, 'base64'));
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) throw new ApiError(422, 'bad_signature', 'the signature does not match the payout address');
  }
  await svc.db.update(supplierConfirmations).set({ payoutAddress: body.payoutAddress, signature: signatureOk ? body.signature : null, acceptedAt: new Date() }).where(eq(supplierConfirmations.id, row.id));
  if (deal.supplierId) await svc.db.update(suppliers).set({ payoutAddress: body.payoutAddress, payoutConfirmedAt: new Date(), payoutSignature: signatureOk ? body.signature : null }).where(eq(suppliers.id, deal.supplierId));
  await audit(svc.db, { actor: null, action: 'supplier_confirm', target: deal.id, after: { payoutAddress: body.payoutAddress, signed: Boolean(signatureOk) } });
  await enqueue(svc.db, 'agent_tick', { reason: 'supplier_confirmed', dealId: deal.id }, { dedupeKey: `agent_tick:${deal.id}:supplier` });
  return reply(c, PurchaseOrderSchema, await purchaseOrderOf(svc, deal));
});
