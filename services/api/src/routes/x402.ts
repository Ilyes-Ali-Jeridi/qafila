/**
 * x402 Verification API (PLAN 7, S1, FF_X402). The paid call stores the documents,
 * creates a job, settles the payment and returns { job_id, job_token } at once; the
 * free job endpoint returns the signed report (purpose 10, deal_id 0).
 * The payment middleware is wired in src/x402/payment.ts once S1 is green; until then
 * the routes answer 501 behind the flag.
 */
import { Hono } from 'hono';
import type { JobRow } from '../db/repo.js';
import { notImplemented } from '../lib/http.js';
import type { Services } from '../services.js';
import type { Vars } from './_shared.js';

export const x402 = new Hono<{ Variables: Vars }>();

x402.post('/v1/verify', () => {
  throw notImplemented('post /x402/v1/verify');
});
x402.get('/v1/jobs/:id', () => {
  throw notImplemented('get /x402/v1/jobs/:id');
});

export async function runX402Job(_svc: Services, _job: JobRow): Promise<unknown> {
  throw new Error('x402 jobs are not built yet');
}
