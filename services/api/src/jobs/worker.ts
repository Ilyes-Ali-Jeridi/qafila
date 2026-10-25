/**
 * Job worker (PLAN 8.4): one loop over the jobs table. Kinds: verify_listing,
 * verify_shipment, x402_verify, agent_tick (also every 10 minutes), index_tick (every
 * 5 s), notify, approve_investor, faucet_grant. Exponential backoff, max 5 attempts,
 * dead jobs surface in the ops console. Runs in the API process with WORKER=1 or on its
 * own with `pnpm --filter ./services/api worker`.
 */
import { eq } from 'drizzle-orm';
import { parseAmount } from '@qafila/shared';
import { importers, profiles } from '../db/schema.js';
import { claimJob, completeJob, enqueue, failJob, type JobRow } from '../db/repo.js';
import { logger } from '../lib/logger.js';
import type { Services } from '../services.js';
import { verifyDeal } from '../services/deals.js';
import { agentTick } from './agent.js';
import { indexOnce } from './indexer.js';
import { sendNotification, type NotifyPayload } from './notify.js';

const log = logger.child({ module: 'worker' });

export type Handler = (svc: Services, job: JobRow) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  verify_listing: (svc, job) => verifyDeal(svc, String(job.payload['dealId']), 'listing'),
  verify_shipment: (svc, job) => verifyDeal(svc, String(job.payload['dealId']), 'shipment'),
  agent_tick: (svc, job) => agentTick(svc, job.payload as { reason?: string; dealId?: string }),
  index_tick: (svc) => indexOnce(svc),
  notify: (svc, job) => sendNotification(svc, job.payload as unknown as NotifyPayload),
  approve_investor: async (svc, job) => {
    const wallet = String(job.payload['walletAddress']);
    const profileId = String(job.payload['profileId']);
    const tx = await svc.chain.approveInvestor(wallet);
    await svc.db.update(profiles).set({ kycStatus: 'approved', kycApprovedTx: tx.txHash }).where(eq(profiles.id, profileId));
    return { txHash: tx.txHash };
  },
  faucet_grant: async (svc, job) => {
    const wallet = String(job.payload['walletAddress']);
    const amount = BigInt(String(job.payload['amount'] ?? parseAmount(svc.env.FAUCET_AMOUNT).toString()));
    const tx = await svc.chain.faucet(wallet, amount);
    if (job.payload['kyb']) await svc.db.update(importers).set({ faucetGrantTx: tx.txHash }).where(eq(importers.profileId, String(job.payload['profileId'])));
    return { txHash: tx.txHash };
  },
  x402_verify: async (svc, job) => {
    const { runX402Job } = await import('../routes/x402.js');
    return runX402Job(svc, job);
  },
};

export async function runOne(svc: Services, job: JobRow): Promise<boolean> {
  const h = handlers[job.kind];
  if (!h) {
    await failJob(svc.db, { ...job, attempts: 99 }, `unknown job kind ${job.kind}`);
    return false;
  }
  const limitMs = job.kind === 'index_tick' ? 60_000 : job.kind === 'agent_tick' ? 5 * 60_000 : 15 * 60_000;
  try {
    const result = await Promise.race([h(svc, job), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`job ${job.kind} timed out after ${limitMs} ms`)), limitMs).unref())]);
    await completeJob(svc.db, job.id, result);
    return true;
  } catch (e) {
    const msg = (e as Error).stack ?? (e as Error).message;
    log.warn({ job: job.id, kind: job.kind, attempt: job.attempts, err: (e as Error).message }, 'job failed');
    await failJob(svc.db, job, msg);
    return false;
  }
}

/** Drain everything runnable now (tests and scripts). */
export async function drain(svc: Services, max = 100): Promise<number> {
  let n = 0;
  for (; n < max; n++) {
    const job = await claimJob(svc.db);
    if (!job) break;
    await runOne(svc, job);
  }
  return n;
}

export function startWorker(svc: Services, opts: { indexEveryMs?: number; agentEveryMs?: number; pollMs?: number } = {}): () => void {
  const indexEvery = opts.indexEveryMs ?? 5000;
  const agentEvery = opts.agentEveryMs ?? 10 * 60 * 1000;
  const pollMs = opts.pollMs ?? 1000;
  let stopped = false;
  let lastIndex = 0;
  let lastAgent = 0;
  const loop = async () => {
    while (!stopped) {
      try {
        const now = Date.now();
        if (now - lastIndex >= indexEvery) {
          lastIndex = now;
          await enqueue(svc.db, 'index_tick', {}, { dedupeKey: 'index_tick' });
        }
        if (now - lastAgent >= agentEvery) {
          lastAgent = now;
          await enqueue(svc.db, 'agent_tick', { reason: 'tick' }, { dedupeKey: 'agent_tick:all:tick' });
        }
        const job = await claimJob(svc.db);
        if (job) {
          await runOne(svc, job);
          continue;
        }
      } catch (e) {
        log.error({ err: (e as Error).message }, 'worker loop error');
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  };
  void loop();
  log.info({ indexEvery, agentEvery }, 'worker started');
  return () => {
    stopped = true;
  };
}
