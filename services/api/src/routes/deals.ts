/**
 * Deal routes (PLAN 8.1, FLOWS 9, .shared/requests-product.md): drafts, documents,
 * verification jobs, reports, the purchase promise, shipment intake, tracking, the
 * importer views, extension requests, purchase order and trade file.
 */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  CreateDealRequest,
  CreateDealResponseSchema,
  DealDetailSchema,
  DealSummarySchema,
  DocumentRecordSchema,
  ExtensionRequest,
  ImporterDealDetailSchema,
  ImporterDealSchema,
  OkSchema,
  PromiseResponse,
  PurchaseOrderSchema,
  RegisterDocumentRequest,
  RegisterDocumentResponseSchema,
  ReportResponseSchema,
  ShipmentRequest,
  ShipmentResponseSchema,
  TradeFileSchema,
  TrackingSnapshotSchema,
  TxSubmittedRequest,
  UpdateDealTermsRequest,
  VerificationReportSchema,
  VerifyResponseSchema,
  type DocumentType,
  type ImporterDeal,
  type ReportResponse,
} from '@qafila/shared';
import { requireUser, type AuthUser } from '../auth.js';
import { enqueue } from '../db/repo.js';
import { checks as checksTable, deals, documents, extensionRequests, promises, reports, shipments, supplierConfirmations, suppliers } from '../db/schema.js';
import { ApiError, reply } from '../lib/http.js';
import { rateLimit } from '../lib/ratelimit.js';
import { categoryOf } from '../pipeline/explain.js';
import { buildPromise, currentDocuments, dealsForList, storeDocument, toDetail, toSummary, ONCHAIN_STATUS, type DealRow, type DraftTerms } from '../services/deals.js';
import type { Services } from '../services.js';
import { assertOwnerOrOps, documentRecords, findDeal, readJson, type Ctx, type Vars } from './_shared.js';

export const dealRoutes = new Hono<{ Variables: Vars }>();

// ---------------------------------------------------------------- public list and detail

dealRoutes.get('/deals', async (c) => {
  const svc = c.get('svc');
  const u = c.get('user');
  const all = c.req.query('all') === '1' && Boolean(u && (u.roles.includes('ops') || u.roles.includes('sharia')));
  const rows = await dealsForList(svc, { all });
  return reply(c, z.array(DealSummarySchema), rows);
});

dealRoutes.post('/deals', rateLimit('create-deal', 30, 60 * 60 * 1000), async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const body = await readJson(c, CreateDealRequest);
  const svc = c.get('svc');
  let supplier = body.supplier.uscc ? await svc.db.query.suppliers.findFirst({ where: eq(suppliers.uscc, body.supplier.uscc) }) : null;
  if (!supplier) {
    const [row] = await svc.db.insert(suppliers).values({ nameEn: body.supplier.nameEn, nameZh: body.supplier.nameZh ?? null, uscc: body.supplier.uscc ?? null, country: body.supplier.country, payoutAddress: body.supplier.payoutAddress ?? null }).returning();
    supplier = row!;
  } else if (body.supplier.payoutAddress && !supplier.payoutAddress) {
    await svc.db.update(suppliers).set({ payoutAddress: body.supplier.payoutAddress }).where(eq(suppliers.id, supplier.id));
  }
  const [deal] = await svc.db
    .insert(deals)
    .values({ importerId: u.profileId, supplierId: supplier.id, status: 'draft', goodsSummary: body.goodsSummary, route: { originPort: body.originPort, originCountry: 'CN', destinationPort: body.destinationPort, destinationCountry: body.destinationCountry }, carrier: body.carrier ?? null, terms: { tenor_secs: body.tenorSecs, incoterms: body.incoterms ?? 'FOB', deposit_bps: svc.env.SUPPLIER_DEPOSIT_BPS, accept_window_secs: svc.env.ACCEPT_WINDOW_SECS, funding_window_secs: svc.env.FUNDING_WINDOW_SECS } })
    .returning();
  return reply(c, CreateDealResponseSchema, { id: deal!.id, number: deal!.number, status: 'draft' }, 201);
});

dealRoutes.get('/deals/:id', async (c) => {
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  if (deal.status === 'kyb') throw new ApiError(404, 'not_found', 'deal not found');
  const u = c.get('user');
  const visible = deal.onchainId !== null || (u && (u.profileId === deal.importerId || u.roles.includes('ops') || u.roles.includes('sharia')));
  if (!visible) throw new ApiError(404, 'not_found', 'deal not found');
  return reply(c, DealDetailSchema, await toDetail(svc, deal));
});

dealRoutes.patch('/deals/:id', async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  if (deal.onchainId) throw new ApiError(409, 'listed', 'terms are fixed once listed');
  const body = await readJson(c, UpdateDealTermsRequest);
  const t = { ...((deal.terms ?? {}) as Partial<DraftTerms>) };
  if (body.tenorSecs) t.tenor_secs = body.tenorSecs;
  if (body.depositBps !== undefined) t.deposit_bps = Math.min(body.depositBps, svc.env.SUPPLIER_DEPOSIT_BPS);
  if (body.cost && u.roles.includes('ops')) t.cost = body.cost; // the cost comes from the invoice; ops may correct it
  if (body.markup && u.roles.includes('ops')) t.markup = body.markup;
  if (body.supplierPayoutAddress && deal.supplierId) await svc.db.update(suppliers).set({ payoutAddress: body.supplierPayoutAddress }).where(eq(suppliers.id, deal.supplierId));
  await svc.db.update(deals).set({ terms: t, updatedAt: new Date() }).where(eq(deals.id, deal.id));
  return reply(c, OkSchema, { ok: true });
});

// ---------------------------------------------------------------- documents

dealRoutes.get('/deals/:id/documents', async (c) => {
  const u = requireUser(c);
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  return reply(c, z.array(DocumentRecordSchema), await documentRecords(svc, deal.id, true));
});

/** JSON: register a pending upload (browser PUTs the bytes). Multipart: store at once. */
dealRoutes.post('/deals/:id/documents', rateLimit('upload', 60, 60 * 60 * 1000), async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  const ct = c.req.header('content-type') ?? '';
  if (ct.startsWith('multipart/form-data')) {
    const form = await c.req.parseBody();
    const file = form['file'];
    const type = String(form['type'] ?? '');
    if (!(file instanceof File)) throw new ApiError(422, 'invalid_body', 'multipart field "file" is required');
    if (!['invoice', 'packing_list', 'business_licence', 'bill_of_lading', 'kyb'].includes(type)) throw new ApiError(422, 'invalid_body', 'field "type" must be a document type');
    const stored = await storeDocument(svc, deal, u.profileId, type as DocumentType, file.name, new Uint8Array(await file.arrayBuffer()), file.type || undefined);
    const rec = (await documentRecords(svc, deal.id, true)).find((d) => d.id === stored.row.id);
    return reply(c, DocumentRecordSchema, rec, 201);
  }
  const body = await readJson(c, RegisterDocumentRequest);
  const [row] = await svc.db
    .insert(documents)
    .values({ dealId: deal.id, type: body.type, storagePath: `deals/${deal.id}/${body.type}-${body.sha256.slice(0, 12)}`, sha256: body.sha256, mime: body.mime, size: body.size, uploadedBy: u.profileId, stage: body.type === 'bill_of_lading' ? 'shipment' : body.type === 'kyb' ? 'kyb' : 'listing', status: 'pending' })
    .returning();
  return reply(c, RegisterDocumentResponseSchema, { documentId: row!.id, uploadUrl: `${svc.env.API_BASE_URL.replace(/\/$/, '')}/deals/${deal.id}/documents/${row!.id}`, method: 'PUT', headers: { 'content-type': body.mime } }, 201);
});

dealRoutes.put('/deals/:id/documents/:docId', rateLimit('upload', 60, 60 * 60 * 1000), async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  const pending = await svc.db.query.documents.findFirst({ where: and(eq(documents.id, c.req.param('docId')), eq(documents.dealId, deal.id)) });
  if (!pending) throw new ApiError(404, 'not_found', 'document not registered');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const stored = await storeDocument(svc, deal, u.profileId, pending.type as DocumentType, pending.storagePath.split('/').pop() ?? pending.type, bytes, c.req.header('content-type') ?? pending.mime, pending.stage as 'listing' | 'shipment');
  if (stored.row.sha256 !== pending.sha256) {
    // The registered hash did not match the bytes: keep the stored row (its hash is the truth) and drop the registration.
    await svc.db.delete(documents).where(eq(documents.id, pending.id));
  } else {
    await svc.db.delete(documents).where(eq(documents.id, pending.id));
  }
  const rec = (await documentRecords(svc, deal.id, true)).find((d) => d.id === stored.row.id);
  return reply(c, DocumentRecordSchema, rec);
});

// ---------------------------------------------------------------- verification

dealRoutes.post('/deals/:id/verify', rateLimit('verify', 20, 60 * 60 * 1000), async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  if (deal.onchainId) throw new ApiError(409, 'listed', 'the deal is already listed');
  const docs = await currentDocuments(svc, deal.id, 'listing');
  if (!docs.some((d) => d.type === 'invoice')) throw new ApiError(422, 'missing_document', 'upload the invoice first');
  await svc.db.update(deals).set({ status: 'verifying', updatedAt: new Date() }).where(eq(deals.id, deal.id));
  const jobId = await enqueue(svc.db, 'verify_listing', { dealId: deal.id }, { dedupeKey: `verify_listing:${deal.id}:${Date.now()}` });
  return reply(c, VerifyResponseSchema, { jobId: jobId ?? '' }, 202);
});

async function reportResponse(svc: Services, reportId: string): Promise<ReportResponse> {
  const r = await svc.db.query.reports.findFirst({ where: eq(reports.id, reportId) });
  if (!r) throw new ApiError(404, 'not_found', 'report not found');
  const report = VerificationReportSchema.parse(JSON.parse(r.canonicalJson));
  const failed = report.checks.filter((x) => x.status === 'fail');
  const fixes = report.checks.filter((x) => (x.status === 'fail' || x.status === 'review' || x.status === 'unavailable') && x.fix).map((x) => ({ check: x.name, document: x.document ?? null, field: x.field ?? null, fix: x.fix! }));
  return { report, reportHash: r.hash, signature: r.signature, verifierPublicKey: svc.verifierPublicKeyHex, stage: r.stage as 'listing' | 'shipment', decision: r.decision as ReportResponse['decision'], riskScore: r.riskScore, explanation: r.explanation, rejectCategory: r.decision === 'reject' ? categoryOf(failed) : null, fixes, createdAt: r.createdAt.toISOString() };
}

/** Importer and ops get the full report; investors and the public get the detail route's public view. */
dealRoutes.get('/deals/:id/report', async (c) => {
  const u = requireUser(c);
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  const stage = c.req.query('stage');
  const id = stage === 'shipment' ? deal.blReportId : stage === 'listing' ? deal.reportId : (deal.blReportId ?? deal.reportId);
  if (!id) throw new ApiError(404, 'no_report', 'no report yet');
  return reply(c, ReportResponseSchema, await reportResponse(svc, id));
});

// ---------------------------------------------------------------- promise

dealRoutes.post('/deals/:id/promise', async (c) => {
  const u = requireUser(c, 'importer');
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  if (!u.walletAddress) throw new ApiError(409, 'no_wallet', 'link your wallet first');
  const out = await buildPromise(svc, deal, u.walletAddress, u.displayName);
  return reply(c, PromiseResponse, out);
});

dealRoutes.post('/deals/:id/promise/submitted', async (c) => {
  const u = requireUser(c, 'importer');
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  const body = await readJson(c, TxSubmittedRequest);
  const p = await svc.db.query.promises.findFirst({ where: eq(promises.dealId, deal.id), orderBy: desc(promises.createdAt) });
  if (p) await svc.db.update(promises).set({ onchainTxHash: body.txHash, signedAt: new Date() }).where(eq(promises.id, p.id));
  await svc.db.update(deals).set({ status: 'promised', updatedAt: new Date() }).where(and(eq(deals.id, deal.id), eq(deals.status, 'approved')));
  return reply(c, OkSchema, { ok: true });
});

// ---------------------------------------------------------------- shipment and tracking

dealRoutes.post('/deals/:id/shipment', rateLimit('shipment', 20, 60 * 60 * 1000), async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  const body = await readJson(c, ShipmentRequest);
  const doc = await svc.db.query.documents.findFirst({ where: and(eq(documents.id, body.documentId), eq(documents.dealId, deal.id), eq(documents.type, 'bill_of_lading')) });
  if (!doc || doc.status !== 'uploaded') throw new ApiError(422, 'missing_document', 'upload the bill of lading first');
  await svc.db
    .insert(shipments)
    .values({ dealId: deal.id, carrier: body.carrier, containerNumbers: body.containers, blNumber: body.blNumber, blDocumentId: doc.id })
    .onConflictDoUpdate({ target: shipments.dealId, set: { carrier: body.carrier, containerNumbers: body.containers, blNumber: body.blNumber, blDocumentId: doc.id, events: [], statusCode: null, lastPolledAt: null } });
  const jobId = await enqueue(svc.db, 'verify_shipment', { dealId: deal.id }, { dedupeKey: `verify_shipment:${deal.id}:${Date.now()}` });
  return reply(c, ShipmentResponseSchema, { shipmentId: deal.id, jobId }, 202);
});

dealRoutes.get('/deals/:id/tracking', async (c) => {
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  const s = await svc.db.query.shipments.findFirst({ where: eq(shipments.dealId, deal.id) });
  if (!s) throw new ApiError(404, 'no_shipment', 'no shipment yet');
  const events = (s.events ?? []) as z.infer<typeof TrackingSnapshotSchema>['events'];
  return reply(c, TrackingSnapshotSchema, { mode: (s.mode as 'live' | 'mock') ?? 'mock', statusCode: s.statusCode, status: null, vessel: s.vessel, imo: s.imo, pol: s.pol, pod: s.pod, departure: s.departure?.toISOString() ?? null, arrival: s.arrival?.toISOString() ?? null, containers: s.containerNumbers, events, lastPolledAt: s.lastPolledAt?.toISOString() ?? null });
});

// ---------------------------------------------------------------- importer views

async function importerDeal(svc: Services, deal: DealRow, user: AuthUser): Promise<ImporterDeal> {
  const onchain = deal.onchainId ? await svc.chain.getDeal(deal.onchainId).catch(() => null) : null;
  const report = deal.reportId ? await svc.db.query.reports.findFirst({ where: eq(reports.id, deal.blReportId ?? deal.reportId) }) : null;
  const stats = user.walletAddress ? await svc.chain.importerStats(user.walletAddress).catch(() => null) : null;
  const summary = await toSummary(svc, deal, onchain, report ? { decision: report.decision, riskScore: report.riskScore } : null, stats);
  const supplier = deal.supplierId ? await svc.db.query.suppliers.findFirst({ where: eq(suppliers.id, deal.supplierId) }) : null;
  const t = (deal.terms ?? {}) as Partial<DraftTerms>;
  const promise = await svc.db.query.promises.findFirst({ where: eq(promises.dealId, deal.id), orderBy: desc(promises.createdAt) });
  const shipment = await svc.db.query.shipments.findFirst({ where: eq(shipments.dealId, deal.id) });
  const ext = await svc.db.query.extensionRequests.findFirst({ where: eq(extensionRequests.dealId, deal.id), orderBy: desc(extensionRequests.createdAt) });
  const confirmation = await svc.db.query.supplierConfirmations.findFirst({ where: eq(supplierConfirmations.dealId, deal.id) });
  const stage = (onchain ? ONCHAIN_STATUS[onchain.state] : deal.status) as ImporterDeal['stage'];
  const fixCount = report ? (await svc.db.query.checks.findMany({ where: eq(checksTable.reportId, report.id) })).filter((x) => x.status === 'fail' || x.status === 'review').length : 0;
  const nextAction: Record<string, string> = {
    draft: 'Upload the invoice, packing list and business licence, then run the screening.',
    verifying: 'Screening is running; this takes about a minute.',
    review: 'Our team is reviewing the report. Fix what the report names and re-run the screening.',
    rejected: 'The deal was rejected. Read the report for the category and the reason.',
    approved: 'Read the purchase promise and sign it with your passkey to lock the security deposit.',
    promised: 'Waiting for ops to list the deal.',
    listed: 'Investors are funding the deal.',
    funded: 'The agent pays the supplier deposit next.',
    deposit_paid: 'Upload the bill of lading once the goods ship.',
    owned: 'Sign the sale at the fixed price within the accept window.',
    sold: 'Repay the price by the due date, in one or more payments.',
    repaid: 'Done. If the last payment was late, pay the late fee to charity.',
    cancelled: 'The deal was cancelled. Collect your refund under Money to collect.',
    defaulted: 'The deal is in default; ops is handling the recovery.',
    liquidated: 'The deal was wound up.',
    closed: 'The deal is closed.',
  };
  const refundOwed = user.walletAddress ? await svc.chain.refundOf(user.walletAddress).catch(() => 0n) : 0n;
  return {
    ...summary,
    stage,
    nextAction: nextAction[stage] ?? '',
    supplier: { nameEn: supplier?.nameEn ?? '', nameZh: supplier?.nameZh ?? null, uscc: supplier?.uscc ?? null, payoutAddress: (supplier?.payoutAddress as ImporterDeal['supplier']['payoutAddress']) ?? null, confirmed: Boolean(confirmation?.acceptedAt) },
    terms: { cost: onchain?.terms.cost ?? t.cost ?? '0', markup: onchain?.terms.markup ?? t.markup ?? '0', platformFee: onchain?.terms.platform_fee ?? t.platform_fee ?? '0', lateFee: onchain?.terms.late_fee ?? t.late_fee ?? '0', depositBps: onchain?.terms.deposit_bps ?? t.deposit_bps ?? svc.env.SUPPLIER_DEPOSIT_BPS, tenorSecs: onchain?.terms.tenor_secs ?? t.tenor_secs ?? 0, acceptWindowSecs: onchain?.terms.accept_window_secs ?? t.accept_window_secs ?? svc.env.ACCEPT_WINDOW_SECS, fundingDeadline: onchain?.terms.funding_deadline ?? null },
    documents: await documentRecords(svc, deal.id, true),
    reportSummary: report ? { decision: report.decision as ImporterDeal['decision'] & string, riskScore: report.riskScore, explanation: report.explanation, fixCount, createdAt: report.createdAt.toISOString() } : null,
    promise: promise ? { textHash: promise.textHash, listingFingerprint: promise.listingFingerprint, security: promise.security, securityBps: promise.securityBps, txHash: promise.onchainTxHash, signedAt: promise.signedAt?.toISOString() ?? null, withdrawable: Boolean(promise.onchainTxHash) && !deal.onchainId, text: promise.text } : null,
    shipment: shipment ? { carrier: shipment.carrier, blNumber: shipment.blNumber, containers: shipment.containerNumbers, status: shipment.statusCode !== null ? String(shipment.statusCode) : null, documentId: shipment.blDocumentId } : null,
    refundOwed: refundOwed.toString(),
    extension: ext ? { requested: true, reason: ext.reason, decision: ext.status as 'pending' | 'granted' | 'refused', newDueAt: ext.status === 'granted' && onchain ? onchain.due_at : null } : null,
  };
}

dealRoutes.get('/importer/deals', async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const svc = c.get('svc');
  const rows = await svc.db.query.deals.findMany({ where: eq(deals.importerId, u.profileId), orderBy: desc(deals.createdAt) });
  const out: ImporterDeal[] = [];
  for (const d of rows) if (d.status !== 'kyb') out.push(await importerDeal(svc, d, u));
  return reply(c, z.array(ImporterDealSchema), out);
});

dealRoutes.get('/importer/deals/:id', async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  const [detail, imp] = await Promise.all([toDetail(svc, deal), importerDeal(svc, deal, u)]);
  return reply(c, ImporterDealDetailSchema, { ...detail, ...imp });
});

// ---------------------------------------------------------------- SHOULD: extension, purchase order, trade file

dealRoutes.post('/deals/:id/extension-request', async (c) => {
  const u = requireUser(c, 'importer');
  const svc = c.get('svc');
  if (!svc.env.FF_EXTENSIONS) throw new ApiError(404, 'not_found', 'extensions are off');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  const body = await readJson(c, ExtensionRequest);
  const existing = await svc.db.query.extensionRequests.findFirst({ where: eq(extensionRequests.dealId, deal.id) });
  if (existing) throw new ApiError(409, 'already_requested', 'one extension request per deal');
  await svc.db.insert(extensionRequests).values({ dealId: deal.id, reason: body.reason, requestedSecs: svc.env.MAX_EXTENSION_SECS });
  await enqueue(svc.db, 'notify', { kind: 'incident', dealId: deal.id, incident: 'extension_request', detail: `The importer asks for more time: ${body.reason.slice(0, 300)}` });
  return reply(c, OkSchema, { ok: true });
});

export async function purchaseOrderOf(svc: Services, deal: DealRow) {
  const supplier = deal.supplierId ? await svc.db.query.suppliers.findFirst({ where: eq(suppliers.id, deal.supplierId) }) : null;
  const t = (deal.terms ?? {}) as Partial<DraftTerms>;
  const conf = await svc.db.query.supplierConfirmations.findFirst({ where: eq(supplierConfirmations.dealId, deal.id), orderBy: desc(supplierConfirmations.createdAt) });
  return { dealNumber: deal.number, entityName: `${svc.env.QAFILA_ENTITY_NAME}, deal ${deal.number}`, supplierName: supplier?.nameEn ?? '', goodsSummary: deal.goodsSummary, cost: t.cost ?? '0', depositBps: t.deposit_bps ?? svc.env.SUPPLIER_DEPOSIT_BPS, payoutAddress: (supplier?.payoutAddress as `G${string}` | null) ?? null, status: conf?.acceptedAt ? ('accepted' as const) : ('pending' as const), acceptedAt: conf?.acceptedAt?.toISOString() ?? null, signature: conf?.signature ?? null };
}

dealRoutes.get('/deals/:id/purchase-order', async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const svc = c.get('svc');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  return reply(c, PurchaseOrderSchema, await purchaseOrderOf(svc, deal));
});

/** S5 trade file: a JSON bundle (documents with signed links, reports, signatures, transaction links). */
dealRoutes.get('/deals/:id/tradefile', async (c) => {
  const u = requireUser(c, 'importer', 'ops');
  const svc = c.get('svc');
  if (!svc.env.FF_TRADE_FILE) throw new ApiError(404, 'not_found', 'trade file is off');
  const deal = await findDeal(svc, c.req.param('id'));
  assertOwnerOrOps(deal, u);
  const detail = await toDetail(svc, deal);
  const docs = await documentRecords(svc, deal.id, true);
  const reportsOut = [];
  for (const id of [deal.reportId, deal.blReportId]) if (id) reportsOut.push(await reportResponse(svc, id));
  const bundle = { deal: detail, documents: docs, reports: reportsOut, verifier: { publicKey: svc.verifierPublicKeyHex, contractId: svc.contractId, network: svc.env.STELLAR_NETWORK }, generatedAt: new Date().toISOString() };
  const bytes = Buffer.from(JSON.stringify(bundle, null, 2));
  const path = `deals/${deal.id}/tradefile-${Date.now()}.json`;
  await svc.adapters.storage.put(path, new Uint8Array(bytes), 'application/json');
  const url = (await svc.adapters.storage.signedUrl(path, 60 * 60)) ?? '';
  return reply(c, TradeFileSchema, { url, filename: `qafila-deal-${deal.number}-trade-file.json`, bytes: bytes.length, contents: ['deal summary and on-chain timeline', ...docs.map((d) => `${d.type} (${d.filename}, sha256 ${d.sha256.slice(0, 12)})`), ...reportsOut.map((r) => `${r.stage} report ${r.reportHash.slice(0, 12)} signed by the verifier`), 'verifier public key and how to verify'] });
});

export { reportResponse };
export type { Ctx };
