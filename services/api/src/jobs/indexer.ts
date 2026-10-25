/**
 * Indexer (PLAN 8.3, SP12): polls getEvents every 5 s filtered by the Qafila contract
 * with a stored cursor, archives every event (the database is the permanent record;
 * RPC keeps about 7 days), re-reads the deal on-chain to update `deals.status`, and
 * queues notifications and agent ticks. Backfill: with no cursor it starts about a day
 * back (or INDEXER_START_LEDGER).
 */
import { eq, and, isNull } from 'drizzle-orm';
import { deals, indexerCursor, onchainEvents, promises } from '../db/schema.js';
import { enqueue } from '../db/repo.js';
import { logger } from '../lib/logger.js';
import type { Services } from '../services.js';
import { ONCHAIN_STATUS } from '../services/deals.js';
import { withTimeout } from '../lib/retry.js';

const log = logger.child({ module: 'indexer' });

const NOTIFY: Record<string, string> = { deal_listed: 'deal_listed', funded: 'funded', deposit_paid: 'deposit_paid', shipment_confirmed: 'shipment_confirmed', murabaha_accepted: 'sale_signed', repaid: 'repaid', late_fee_to_charity: 'late_fee_charity', due_extended: 'due_extended', refunded: 'security_refunded', security_used: 'security_used' };
const AGENT_TRIGGERS = new Set(['funded', 'late_fee_to_charity', 'repaid', 'refund_owed', 'closed', 'cancelled', 'aborted', 'liquidated']);

export const cursorKey = (svc: Services): string => `${svc.chain.contractId ?? 'mock'}:${svc.chain.mode}`;

export async function indexOnce(svc: Services): Promise<{ events: number; cursor: string | null; lagSecs: number | null }> {
  const contractId = cursorKey(svc);
  const row = await svc.db.query.indexerCursor.findFirst({ where: eq(indexerCursor.contractId, contractId) });
  const start = process.env['INDEXER_START_LEDGER'] ? Number(process.env['INDEXER_START_LEDGER']) : null;
  let res;
  try {
    res = await withTimeout(() => svc.chain.getEvents(row?.cursor ?? null, start), 25_000);
  } catch (e) {
    const msg = (e as Error).message;
    log.warn({ err: msg }, 'getEvents failed');
    if (row && /cursor|startLedger|ledger/i.test(msg)) {
      // A stale or foreign cursor (for example from a mock run): start again from the recent window.
      await svc.db.delete(indexerCursor).where(eq(indexerCursor.contractId, contractId));
      log.warn({ cursor: row.cursor }, 'indexer cursor reset');
    }
    return { events: 0, cursor: row?.cursor ?? null, lagSecs: null };
  }
  let stored = 0;
  const touched = new Set<number>();
  for (const e of res.events) {
    const inserted = await svc.db
      .insert(onchainEvents)
      .values({ contractId, ledger: e.ledger, txHash: e.txHash, eventIndex: e.eventIndex, eventType: e.type, dealOnchainId: e.dealId, data: e.data, ledgerClosedAt: e.ledgerClosedAt ? new Date(e.ledgerClosedAt) : null })
      .onConflictDoNothing({ target: [onchainEvents.txHash, onchainEvents.eventIndex] })
      .returning({ id: onchainEvents.id });
    if (!inserted.length) continue;
    stored++;
    if (e.dealId !== null) touched.add(e.dealId);
    const deal = e.dealId !== null ? await svc.db.query.deals.findFirst({ where: eq(deals.onchainId, e.dealId) }) : null;
    if (deal && NOTIFY[e.type]) await enqueue(svc.db, 'notify', { kind: NOTIFY[e.type], dealId: deal.id, amount: typeof e.data['amount'] === 'string' ? e.data['amount'] : undefined });
    if (deal && e.type === 'repaid' && e.data['state'] === 'Repaid') await enqueue(svc.db, 'notify', { kind: 'repaid_claim', dealId: deal.id });
    if (AGENT_TRIGGERS.has(e.type)) await enqueue(svc.db, 'agent_tick', { reason: e.type, dealId: deal?.id }, { dedupeKey: `agent_tick:${deal?.id ?? 'all'}:${e.type}:${e.ledger}` });
    if (e.type === 'promised' && typeof e.data['listing_fingerprint'] === 'string') {
      const fp = e.data['listing_fingerprint'];
      const d = await svc.db.query.deals.findFirst({ where: eq(deals.listingFingerprint, fp) });
      if (d && ['approved', 'review'].includes(d.status)) await svc.db.update(deals).set({ status: 'promised', updatedAt: new Date() }).where(eq(deals.id, d.id));
      // Record the signing transaction on the promise so the importer's page can link it even when the browser's best-effort report did not arrive.
      await svc.db.update(promises).set({ onchainTxHash: e.txHash, signedAt: new Date() }).where(and(eq(promises.listingFingerprint, fp), isNull(promises.onchainTxHash)));
    }
  }
  for (const onchainId of touched) {
    const deal = await svc.db.query.deals.findFirst({ where: eq(deals.onchainId, onchainId) });
    if (!deal) continue;
    const on = await svc.chain.getDeal(onchainId).catch(() => null);
    if (on && ONCHAIN_STATUS[on.state] !== deal.status) await svc.db.update(deals).set({ status: ONCHAIN_STATUS[on.state], updatedAt: new Date() }).where(eq(deals.id, deal.id));
  }
  const cursor = res.cursor ?? row?.cursor ?? null;
  await svc.db.insert(indexerCursor).values({ contractId, cursor, lastLedger: res.latestLedger, updatedAt: new Date() }).onConflictDoUpdate({ target: indexerCursor.contractId, set: { cursor, lastLedger: res.latestLedger, updatedAt: new Date() } });
  if (stored) log.info({ stored, cursor }, 'indexed');
  return { events: stored, cursor, lagSecs: 0 };
}

export async function indexerLagSecs(svc: Services): Promise<number | null> {
  const row = await svc.db.query.indexerCursor.findFirst({ where: eq(indexerCursor.contractId, cursorKey(svc)) });
  return row ? Math.round((Date.now() - row.updatedAt.getTime()) / 1000) : null;
}
