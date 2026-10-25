/**
 * Database-backed building blocks: the 24 h external-call cache, the fingerprint
 * store, the halal policy table (seeded from the default), the audit log and the
 * job queue (PLAN 8.2, 8.4).
 */
import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { AdapterCache, CacheEntry } from '../adapters/base.js';
import { DEFAULT_HALAL_POLICY } from '../pipeline/halal.js';
import type { FingerprintStore, HalalPolicy } from '../pipeline/types.js';
import type { Db } from './index.js';
import { auditLog, deals, externalCalls, jobs, policy } from './schema.js';

export class DbCache implements AdapterCache {
  constructor(private readonly db: Db) {}
  async get(adapter: string, hash: string): Promise<CacheEntry | null> {
    const row = await this.db.query.externalCalls.findFirst({ where: and(eq(externalCalls.adapter, adapter), eq(externalCalls.requestHash, hash), gt(externalCalls.cachedUntil, new Date())) });
    if (!row || row.status !== 'ok') return null;
    const r = row.response as { raw: unknown; fixture?: string | null };
    return { raw: r.raw, cost: Number(row.cost ?? 0), mode: row.mode as 'live' | 'mock', fixture: r.fixture ?? null };
  }
  async set(adapter: string, hash: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    await this.db
      .insert(externalCalls)
      .values({ adapter, requestHash: hash, response: { raw: entry.raw, fixture: entry.fixture }, status: 'ok', cost: String(entry.cost), mode: entry.mode, cachedUntil: new Date(Date.now() + ttlMs) })
      .onConflictDoUpdate({ target: [externalCalls.adapter, externalCalls.requestHash], set: { response: { raw: entry.raw, fixture: entry.fixture }, status: 'ok', cost: String(entry.cost), mode: entry.mode, cachedUntil: new Date(Date.now() + ttlMs), createdAt: new Date() } });
  }
}

export class DbFingerprints implements FingerprintStore {
  constructor(private readonly db: Db) {}
  async hasListing(hex: string): Promise<string | null> {
    const row = await this.db.query.deals.findFirst({ where: eq(deals.listingFingerprint, hex), columns: { id: true, number: true } });
    return row ? `deal ${row.number}` : null;
  }
  async hasShipment(hex: string): Promise<string | null> {
    const row = await this.db.query.deals.findFirst({ where: eq(deals.shipmentFingerprint, hex), columns: { id: true, number: true } });
    return row ? `deal ${row.number}` : null;
  }
  async addListing(hex: string, dealRef: string): Promise<void> {
    await this.db.update(deals).set({ listingFingerprint: hex }).where(eq(deals.id, dealRef));
  }
  async addShipment(hex: string, dealRef: string): Promise<void> {
    await this.db.update(deals).set({ shipmentFingerprint: hex }).where(eq(deals.id, dealRef));
  }
}

export async function getPolicy(db: Db): Promise<HalalPolicy> {
  const row = await db.query.policy.findFirst({ orderBy: (p, { desc }) => [desc(p.version)] });
  if (!row) {
    await db.insert(policy).values({ version: DEFAULT_HALAL_POLICY.version, halalCategories: DEFAULT_HALAL_POLICY.categories, thresholds: DEFAULT_HALAL_POLICY.thresholds });
    return DEFAULT_HALAL_POLICY;
  }
  return { version: row.version, categories: row.halalCategories as HalalPolicy['categories'], thresholds: row.thresholds as HalalPolicy['thresholds'] };
}

export async function savePolicy(db: Db, p: Omit<HalalPolicy, 'version'>, updatedBy: string | null): Promise<HalalPolicy> {
  const current = await getPolicy(db);
  const version = current.version + 1;
  await db.insert(policy).values({ version, halalCategories: p.categories, thresholds: p.thresholds, updatedBy });
  return { version, ...p };
}

export async function audit(db: Db, entry: { actor: string | null; action: string; target: string; before?: unknown; after?: unknown; reason?: string | null }): Promise<void> {
  await db.insert(auditLog).values({ actor: entry.actor, action: entry.action, target: entry.target, before: entry.before ?? null, after: entry.after ?? null, reason: entry.reason ?? null });
}

export type JobKind = 'verify_listing' | 'verify_shipment' | 'x402_verify' | 'agent_tick' | 'index_tick' | 'notify' | 'approve_investor' | 'faucet_grant' | 'list_deal';

export interface JobRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export const JOB_MAX_ATTEMPTS = 5;

export async function enqueue(db: Db, kind: JobKind, payload: Record<string, unknown>, opts: { runAfter?: Date; dedupeKey?: string } = {}): Promise<string | null> {
  const rows = await db
    .insert(jobs)
    .values({ kind, payload, runAfter: opts.runAfter ?? new Date(), dedupeKey: opts.dedupeKey ?? null })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}

/** Claim the next runnable job with SKIP LOCKED semantics (single worker, but safe for two). */
export async function claimJob(db: Db, kinds?: JobKind[]): Promise<JobRow | null> {
  const stale = new Date(Date.now() - 5 * 60 * 1000);
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: jobs.id, kind: jobs.kind, payload: jobs.payload, attempts: jobs.attempts })
      .from(jobs)
      .where(and(or(eq(jobs.status, 'queued'), and(eq(jobs.status, 'running'), lt(jobs.lockedAt, stale))), lt(jobs.runAfter, new Date()), kinds?.length ? sql`${jobs.kind} = ANY(${kinds})` : sql`true`))
      .orderBy(asc(jobs.runAfter))
      .limit(1)
      .for('update', { skipLocked: true });
    const j = candidates[0];
    if (!j) return null;
    await tx.update(jobs).set({ status: 'running', lockedAt: new Date(), attempts: j.attempts + 1 }).where(eq(jobs.id, j.id));
    return { id: j.id, kind: j.kind, payload: (j.payload ?? {}) as Record<string, unknown>, attempts: j.attempts + 1 };
  });
}

/** A worker that starts owns every job a dead predecessor left `running` (one worker per deployment). */
export async function requeueStale(db: Db, olderThanMs = 30_000): Promise<number> {
  const rows = await db.update(jobs).set({ status: 'queued', lockedAt: null }).where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, new Date(Date.now() - olderThanMs)))).returning({ id: jobs.id });
  return rows.length;
}

export async function completeJob(db: Db, id: string, result: unknown): Promise<void> {
  await db.update(jobs).set({ status: 'done', result: result ?? null, finishedAt: new Date(), lockedAt: null, dedupeKey: null }).where(eq(jobs.id, id));
}

export async function failJob(db: Db, job: JobRow, error: string): Promise<void> {
  const dead = job.attempts >= JOB_MAX_ATTEMPTS;
  const backoff = Math.min(10 * 60 * 1000, 5000 * 2 ** job.attempts);
  await db.update(jobs).set({ status: dead ? 'dead' : 'queued', lastError: error.slice(0, 2000), lockedAt: null, runAfter: new Date(Date.now() + backoff), ...(dead ? { finishedAt: new Date(), dedupeKey: null } : {}) }).where(eq(jobs.id, job.id));
}

export async function deadJobs(db: Db): Promise<Array<{ id: string; kind: string; lastError: string | null; attempts: number; createdAt: Date }>> {
  return db.select({ id: jobs.id, kind: jobs.kind, lastError: jobs.lastError, attempts: jobs.attempts, createdAt: jobs.createdAt }).from(jobs).where(eq(jobs.status, 'dead')).orderBy(asc(jobs.createdAt)).limit(100);
}

export async function jobById(db: Db, id: string) {
  return db.query.jobs.findFirst({ where: and(eq(jobs.id, id), isNull(sql`null`)) });
}
