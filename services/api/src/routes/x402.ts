/**
 * x402 Verification API (PLAN 7, S1, FF_X402). Other lenders and agents buy a signed
 * verification report in Circle testnet USDC through the OpenZeppelin facilitator.
 *
 *   POST /x402/v1/verify      paid (X402_PRICE_USDC): multipart documents + form JSON;
 *                             stores the files, creates a job, returns { job_id, job_token }
 *   GET  /x402/v1/jobs/:id    free, needs job_token: status, then the signed report
 *                             (purpose 10, deal_id 0, payload_hash = report_hash)
 *
 * The pipeline can take a minute, longer than a payment authorization should wait, so
 * the paid call never runs it inline (maxTimeoutSeconds 300 on the requirements).
 * Fail closed: without the facilitator key and payTo the paid route answers 503.
 */
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { DocumentTypeSchema, SignedReportSchema, VerificationReportSchema, type DocumentType } from '@qafila/shared';
import { x402Payments } from '../db/schema.js';
import { enqueue, type JobRow } from '../db/repo.js';
import type { Env } from '../env.js';
import { ApiError, reply } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { rateLimit } from '../lib/ratelimit.js';
import { sha256Hex } from '../lib/hash.js';
import { VERIFY_HOWTO } from '../pipeline/attest.js';
import { ingestDocument, sniffMime } from '../pipeline/documents.js';
import { runPipeline } from '../pipeline/run.js';
import type { DealContext, InputDocument } from '../pipeline/types.js';
import { DbFingerprints } from '../db/repo.js';
import type { Services } from '../services.js';
import { readJson, type Vars } from './_shared.js';
import { reports } from '../db/schema.js';

const log = logger.child({ module: 'x402' });

export const X402_NETWORK = 'stellar:testnet' as const;

const FormSchema = z.object({
  importer: z.object({ name: z.string().min(1), country: z.string().length(2) }),
  supplier: z.object({ name_en: z.string().min(1), name_zh: z.string().optional(), uscc: z.string().length(18).optional(), country: z.string().length(2).default('CN') }),
  goods_summary: z.string().min(3).max(200),
  entity_name: z.string().min(1).default('the buyer'),
  deal_number: z.number().int().positive().default(1),
  incoterms: z.string().optional(),
  origin_port: z.string().min(1),
  destination_port: z.string().min(1),
  destination_country: z.string().length(2),
  carrier: z.string().optional(),
  containers: z.array(z.string()).optional(),
  bl_number: z.string().optional(),
});

export function x402Ready(env: Env): boolean {
  return Boolean(env.FF_X402 && env.X402_FACILITATOR_URL && env.X402_FACILITATOR_API_KEY && env.X402_PAYTO_ADDRESS && /^G[A-Z2-7]{55}$/.test(env.X402_PAYTO_ADDRESS));
}

export function createX402Routes(env: Env) {
  const x402 = new Hono<{ Variables: Vars }>();
  const ready = x402Ready(env);
  if (ready) {
    const facilitator = new HTTPFacilitatorClient({
      url: env.X402_FACILITATOR_URL!,
      createAuthHeaders: async () => {
        const h = { Authorization: `Bearer ${env.X402_FACILITATOR_API_KEY}` };
        return { verify: h, settle: h, supported: h };
      },
    });
    const server = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactStellarScheme());
    x402.use(
      '/v1/verify',
      paymentMiddleware(
        {
          'POST /x402/v1/verify': {
            accepts: { scheme: 'exact', price: `$${env.X402_PRICE_USDC}`, network: X402_NETWORK, payTo: env.X402_PAYTO_ADDRESS!, maxTimeoutSeconds: 300 },
            description: 'Qafila trade-document verification: returns a job id; the signed report (ed25519, verifiable on the Qafila contract) comes from GET /x402/v1/jobs/:id',
            mimeType: 'application/json',
            serviceName: 'Qafila Verification API',
            unpaidResponseBody: async () => ({ contentType: 'application/json', body: { error: { code: 'payment_required', message: `pay ${env.X402_PRICE_USDC} USDC over x402 (${X402_NETWORK}) to run a verification; documents: multipart fields form (JSON), invoice, packing_list, business_licence, optional bill_of_lading` } } }),
          },
        },
        server,
        { appName: 'Qafila', testnet: true },
      ),
    );
  } else {
    x402.use('/v1/verify', async () => {
      throw new ApiError(503, 'x402_unavailable', 'x402 is not configured (X402_FACILITATOR_API_KEY and X402_PAYTO_ADDRESS)');
    });
  }

  x402.post('/v1/verify', rateLimit('x402', 20, 60 * 60 * 1000, (c) => c.req.header('payment-signature')?.slice(0, 64) ?? c.req.header('x-payment')?.slice(0, 64) ?? 'anon'), async (c) => {
    const svc = c.get('svc');
    const ct = c.req.header('content-type') ?? '';
    if (!ct.startsWith('multipart/form-data')) throw new ApiError(422, 'invalid_body', 'send multipart/form-data with form (JSON) and the document files');
    const body = await c.req.parseBody({ all: false });
    const formRaw = body['form'];
    if (typeof formRaw !== 'string') throw new ApiError(422, 'invalid_body', 'field "form" (JSON) is required');
    let formJson: unknown;
    try {
      formJson = JSON.parse(formRaw);
    } catch {
      throw new ApiError(422, 'invalid_body', 'field "form" is not valid JSON');
    }
    const form = FormSchema.safeParse(formJson);
    if (!form.success) throw new ApiError(422, 'invalid_body', 'form failed validation', form.error.issues);
    const requestId = randomBytes(16).toString('hex');
    const jobToken = randomBytes(24).toString('hex');
    const docs: Array<{ type: DocumentType; path: string; sha256: string; pages: number }> = [];
    for (const key of ['invoice', 'packing_list', 'business_licence', 'bill_of_lading'] as const) {
      const f = body[key];
      if (!(f instanceof File)) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes.length > 15 * 1024 * 1024) throw new ApiError(422, 'too_large', `${key} is larger than 15 MB`);
      const mime = sniffMime(bytes, f.type || undefined);
      const ingested = await ingestDocument(bytes, mime);
      if (ingested.truncated) throw new ApiError(422, 'too_many_pages', `${key} has more than 20 pages`);
      const path = `x402/${requestId}/${key}.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`;
      await svc.adapters.storage.put(path, bytes, mime);
      docs.push({ type: DocumentTypeSchema.parse(key), path, sha256: ingested.sha256, pages: ingested.pageCount });
    }
    if (!docs.some((d) => d.type === 'invoice')) throw new ApiError(422, 'missing_document', 'an invoice file is required');
    const paymentHeader = c.req.header('payment-signature') ?? c.req.header('x-payment') ?? null;
    let payer: string | null = null;
    if (paymentHeader) {
      try {
        const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8')) as { payload?: { from?: string; sender?: string; payer?: string } };
        payer = decoded.payload?.from ?? decoded.payload?.sender ?? decoded.payload?.payer ?? null;
      } catch {
        payer = null;
      }
    }
    const jobId = await enqueue(svc.db, 'x402_verify', { requestId, form: form.data, documents: docs }, { dedupeKey: `x402:${requestId}` });
    await svc.db.insert(x402Payments).values({ requestId, payer, amount: env.X402_PRICE_USDC, txHash: null, jobId, reportId: null });
    await svc.db.update(x402Payments).set({ txHash: `token:${sha256Hex(jobToken)}` }).where(eq(x402Payments.requestId, requestId));
    log.info({ requestId, jobId, docs: docs.length, payer: payer?.slice(0, 6) }, 'x402 verification queued');
    return c.json({ job_id: jobId, job_token: jobToken, status_url: `${env.API_BASE_URL.replace(/\/$/, '')}/x402/v1/jobs/${jobId}`, price_usdc: env.X402_PRICE_USDC, network: X402_NETWORK }, 202);
  });

  x402.get('/v1/jobs/:id', async (c) => {
    const svc = c.get('svc');
    const id = c.req.param('id');
    const token = c.req.query('job_token') ?? c.req.header('x-job-token') ?? '';
    const payment = await svc.db.query.x402Payments.findFirst({ where: eq(x402Payments.jobId, id) });
    if (!payment || !token || payment.txHash !== `token:${sha256Hex(token)}`) throw new ApiError(404, 'not_found', 'unknown job or bad token');
    const job = await svc.db.query.jobs.findFirst({ where: (j, { eq: e }) => e(j.id, id) });
    if (!job) throw new ApiError(404, 'not_found', 'job not found');
    if (job.status !== 'done' || !payment.reportId) return c.json({ job_id: id, status: job.status === 'dead' ? 'failed' : job.status, attempts: job.attempts, error: job.status === 'dead' ? job.lastError : null, report: null });
    const r = await svc.db.query.reports.findFirst({ where: eq(reports.id, payment.reportId) });
    if (!r) throw new ApiError(404, 'not_found', 'report missing');
    const report = VerificationReportSchema.parse(JSON.parse(r.canonicalJson));
    const signed = SignedReportSchema.parse({ report, report_hash: r.hash, purpose: 10, deal_id: 0, signature: r.signature ?? '0'.repeat(128), verifier_public_key: svc.verifierPublicKeyHex ?? '0'.repeat(64), network_passphrase: env.NETWORK_PASSPHRASE, contract_id: svc.contractId ?? '', verify_howto: VERIFY_HOWTO });
    return c.json({ job_id: id, status: 'done', report: signed });
  });

  return x402;
}

/** x402_verify job: run the pipeline on the stored files and sign the report with purpose 10. */
export async function runX402Job(svc: Services, job: JobRow): Promise<unknown> {
  const payload = job.payload as { requestId: string; form: z.infer<typeof FormSchema>; documents: Array<{ type: DocumentType; path: string }> };
  const form = FormSchema.parse(payload.form);
  const ctx: DealContext = {
    dealRef: `x402-${payload.requestId}`,
    dealNumber: form.deal_number,
    entityName: form.entity_name,
    importer: { name: form.importer.name, country: form.importer.country },
    supplier: { nameEn: form.supplier.name_en, nameZh: form.supplier.name_zh, uscc: form.supplier.uscc, country: form.supplier.country },
    goodsSummary: form.goods_summary,
    incoterms: form.incoterms,
    originPort: form.origin_port,
    destinationPort: form.destination_port,
    destinationCountry: form.destination_country,
    carrier: form.carrier,
    containers: form.containers,
    blNumber: form.bl_number,
  };
  const inputs: InputDocument[] = [];
  for (const d of payload.documents) inputs.push({ type: d.type, filename: d.path.split('/').pop() ?? d.type, bytes: await svc.adapters.storage.get(d.path) });
  const deps = { ...(await svc.pipelineDeps()), fingerprints: new DbFingerprints(svc.db) };
  let result = await runPipeline(ctx, inputs.filter((i) => i.type !== 'bill_of_lading'), deps, { stage: 'listing' });
  if (inputs.some((i) => i.type === 'bill_of_lading') && result.report.decision !== 'reject') {
    result = await runPipeline(ctx, inputs, deps, { stage: 'shipment', priorExtracted: result.extracted, priorIngested: result.ingested });
  }
  const [row] = await svc.db
    .insert(reports)
    .values({ dealId: null, stage: result.report.stage, canonicalJson: result.canonical, hash: result.reportHash, decision: result.report.decision, riskScore: result.report.risk_score, signature: result.signature, purpose: 10, promptVersions: [...new Set(result.report.models.map((m) => m.prompt_version))], modelIds: [...new Set(result.report.models.map((m) => m.model_id))], adapterModes: result.report.adapter_modes, latencyMs: result.report.timings_ms['total'] ?? null, costUsd: String(result.report.cost_usd), explanation: result.report.explanation })
    .returning();
  await svc.db.update(x402Payments).set({ reportId: row!.id }).where(eq(x402Payments.requestId, payload.requestId));
  for (const d of payload.documents) await svc.adapters.storage.remove(d.path).catch(() => undefined);
  return { reportId: row!.id, decision: result.report.decision, reportHash: result.reportHash };
}

export { readJson };
