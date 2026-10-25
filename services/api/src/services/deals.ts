/**
 * Deal operations shared by the routes and the jobs (PLAN 8.1, FLOWS 9): drafts,
 * documents, the verification pipeline on stored documents, the purchase promise,
 * listing (factory, LIST attestation, list_deal), abort with the O-5 reason list,
 * shipment intake and the summary / detail mappers.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ABORT_REASONS, DealTermsSchema, formatAmount, parseAmount, renderPromiseText, PROMISE_TEMPLATE_VERSION, type AbortReason, type DealDetail, type DealSummary, type DealTerms, type DocumentType, type OnchainDeal, type VerificationReport } from '@qafila/shared';
import { sha256, toHex } from '@qafila/shared/attestation';
import type { Db } from '../db/index.js';
import { audit, enqueue } from '../db/repo.js';
import { checks as checksTable, deals, documents, incidents, onchainEvents, profiles, promises, reports, shipments, suppliers, type deals as DealsTable } from '../db/schema.js';
import { ApiError } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { signList } from '../pipeline/attest.js';
import { ingestDocument, sniffMime } from '../pipeline/documents.js';
import { usdRate } from '../pipeline/price.js';
import { runPipeline } from '../pipeline/run.js';
import type { DealContext, InputDocument } from '../pipeline/types.js';
import type { Services } from '../services.js';
import { PORTS } from './ports.js';

const log = logger.child({ module: 'deals' });

export type DealRow = typeof DealsTable.$inferSelect;

export interface DraftTerms {
  cost: string; // stroops, settlement units
  markup: string;
  platform_fee: string;
  late_fee: string;
  security: string;
  security_bps: number;
  deposit_bps: number;
  tenor_secs: number;
  accept_window_secs: number;
  funding_window_secs: number;
  invoice_total: string;
  invoice_currency: string;
  fx_rate: number;
  fx_source: string;
}

export const ONCHAIN_STATUS: Record<OnchainDeal['state'], string> = { Listed: 'listed', Funded: 'funded', DepositPaid: 'deposit_paid', Owned: 'owned', Sold: 'sold', Repaid: 'repaid', Cancelled: 'cancelled', Defaulted: 'defaulted', Liquidated: 'liquidated', Closed: 'closed' };

export async function loadDeal(db: Db, id: string): Promise<DealRow> {
  const row = await db.query.deals.findFirst({ where: eq(deals.id, id) });
  if (!row) throw new ApiError(404, 'not_found', 'deal not found');
  return row;
}

export async function dealContext(svc: Services, deal: DealRow): Promise<DealContext> {
  const importer = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, deal.importerId) });
  const importerRow = await svc.db.query.importers.findFirst({ where: (t, { eq: e }) => e(t.profileId, deal.importerId) });
  const supplier = deal.supplierId ? await svc.db.query.suppliers.findFirst({ where: eq(suppliers.id, deal.supplierId) }) : null;
  const route = deal.route as { originPort: string; destinationPort: string; destinationCountry: string };
  const shipment = await svc.db.query.shipments.findFirst({ where: eq(shipments.dealId, deal.id) });
  const terms = (deal.terms ?? {}) as Partial<DraftTerms> & { incoterms?: string; registry_override?: boolean };
  return {
    dealRef: deal.id,
    dealNumber: deal.number,
    entityName: svc.env.QAFILA_ENTITY_NAME,
    importer: { name: importerRow?.legalName ?? importer?.displayName ?? 'Importer', country: importerRow?.country ?? importer?.country ?? route.destinationCountry },
    supplier: { nameEn: supplier?.nameEn ?? 'Supplier', nameZh: supplier?.nameZh ?? undefined, uscc: supplier?.uscc ?? undefined, country: supplier?.country ?? 'CN' },
    goodsSummary: deal.goodsSummary,
    currency: deal.currency ?? undefined,
    incoterms: terms.incoterms,
    originPort: route.originPort,
    destinationPort: route.destinationPort,
    destinationCountry: route.destinationCountry,
    carrier: shipment?.carrier ?? deal.carrier ?? undefined,
    containers: shipment?.containerNumbers ?? undefined,
    blNumber: shipment?.blNumber ?? undefined,
    registryOverride: terms.registry_override ?? false,
  };
}

export async function storeDocument(svc: Services, deal: DealRow, uploadedBy: string | null, type: DocumentType, filename: string, bytes: Uint8Array, declaredMime?: string, stage: 'listing' | 'shipment' = type === 'bill_of_lading' ? 'shipment' : 'listing') {
  const mime = sniffMime(bytes, declaredMime);
  if (bytes.length > 15 * 1024 * 1024) throw new ApiError(422, 'too_large', 'file larger than 15 MB');
  const hash = toHex(sha256(bytes));
  const dup = await svc.db.query.documents.findFirst({ where: and(eq(documents.sha256, hash), eq(documents.status, 'uploaded')) });
  if (dup && dup.dealId !== deal.id) {
    const other = await svc.db.query.deals.findFirst({ where: eq(deals.id, dup.dealId), columns: { status: true, number: true } });
    if (other && other.status === 'rejected') throw new ApiError(409, 'document_rejected_before', `this exact file was part of rejected deal ${other.number} and cannot be resubmitted`);
  }
  const ingested = await ingestDocument(bytes, mime);
  const path = `deals/${deal.id}/${type}-${hash.slice(0, 12)}.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`;
  await svc.adapters.storage.put(path, bytes, mime);
  await svc.db.update(documents).set({ status: 'replaced' }).where(and(eq(documents.dealId, deal.id), eq(documents.type, type), eq(documents.status, 'uploaded')));
  const [row] = await svc.db.insert(documents).values({ dealId: deal.id, type, storagePath: path, sha256: hash, mime, size: bytes.length, pages: ingested.pageCount, uploadedBy, stage, status: 'uploaded' }).returning();
  log.info({ deal: deal.id, type, pages: ingested.pageCount, hash: hash.slice(0, 12) }, 'document stored');
  return { row: row!, filename, ingested };
}

export async function currentDocuments(svc: Services, dealId: string, stage?: 'listing' | 'shipment') {
  const rows = await svc.db.query.documents.findMany({ where: and(eq(documents.dealId, dealId), eq(documents.status, 'uploaded')), orderBy: desc(documents.createdAt) });
  return stage ? rows.filter((r) => r.stage === stage || (stage === 'shipment' && r.stage === 'listing')) : rows;
}

/** Run the pipeline on the stored documents and persist the report (job handler). */
export async function verifyDeal(svc: Services, dealId: string, stage: 'listing' | 'shipment'): Promise<{ reportId: string; report: VerificationReport }> {
  const deal = await loadDeal(svc.db, dealId);
  const ctx = await dealContext(svc, deal);
  const docs = await currentDocuments(svc, dealId);
  const inputs: InputDocument[] = [];
  for (const d of docs) {
    if (stage === 'listing' && d.type === 'bill_of_lading') continue;
    const bytes = await svc.adapters.storage.get(d.storagePath);
    inputs.push({ type: d.type as DocumentType, filename: d.storagePath.split('/').pop() ?? d.type, bytes, mime: d.mime });
  }
  const deps = await svc.pipelineDeps();
  const result = await runPipeline(ctx, inputs, deps, { stage });
  const [row] = await svc.db
    .insert(reports)
    .values({
      dealId,
      stage,
      canonicalJson: result.canonical,
      hash: result.reportHash,
      decision: result.report.decision,
      riskScore: result.report.risk_score,
      signature: result.signature,
      purpose: 10,
      promptVersions: [...new Set(result.report.models.map((m) => m.prompt_version))],
      modelIds: [...new Set(result.report.models.map((m) => m.model_id))],
      adapterModes: result.report.adapter_modes,
      latencyMs: result.report.timings_ms['total'] ?? null,
      costUsd: String(result.report.cost_usd),
      explanation: result.report.explanation,
    })
    .returning();
  const reportId = row!.id;
  if (result.report.checks.length) await svc.db.insert(checksTable).values(result.report.checks.map((c) => ({ reportId, name: c.name, status: c.status, severity: c.severity, evidence: { detail: c.detail, evidence: c.evidence ?? null, fix: c.fix ?? null, document: c.document ?? null, field: c.field ?? null, weight: c.weight } })));
  const patch: Partial<DealRow> = { updatedAt: new Date() };
  if (stage === 'listing') {
    patch.reportId = reportId;
    patch.status = result.report.decision === 'approve' ? 'approved' : result.report.decision === 'reject' ? 'rejected' : 'review';
    if (result.report.listing_fingerprint && result.report.decision !== 'reject') patch.listingFingerprint = result.report.listing_fingerprint;
    const inv = result.extracted.invoice;
    if (inv?.total.value !== null && inv?.total.value !== undefined) {
      const currency = (inv.currency.value ?? deal.currency ?? 'USD').toUpperCase();
      const fx = await usdRate(currency, svc.adapters, svc.adapters.modes['reflector'] !== 'off');
      const usd = inv.total.value * (fx.rate || (currency === 'USD' ? 1 : 0));
      patch.terms = { ...(deal.terms as object), ...draftTerms(svc, usd, currency, inv.total.value, fx.rate, fx.source, ((deal.terms as Partial<DraftTerms> | null)?.tenor_secs ?? 90 * 86400), '0') };
      patch.currency = currency;
    }
  } else {
    patch.blReportId = reportId;
    if (result.report.shipment_fingerprint && result.report.decision === 'approve') patch.shipmentFingerprint = result.report.shipment_fingerprint;
    await svc.db.update(shipments).set({ mode: result.report.tracking?.mode ?? null, statusCode: result.report.tracking?.statusCode ?? null, vessel: result.report.tracking?.vessel ?? null, imo: result.report.tracking?.imo ?? null, pol: result.report.tracking?.pol ?? null, pod: result.report.tracking?.pod ?? null, events: result.report.tracking?.events ?? [], lastPolledAt: new Date() }).where(eq(shipments.dealId, dealId));
  }
  await svc.db.update(deals).set(patch).where(eq(deals.id, dealId));
  await enqueue(svc.db, 'notify', { kind: 'verification_done', dealId, stage, decision: result.report.decision });
  if (stage === 'shipment') await enqueue(svc.db, 'agent_tick', { reason: 'bl_verified', dealId }, { dedupeKey: `agent_tick:${dealId}:bl` });
  return { reportId, report: result.report };
}

export function draftTerms(svc: Services, costUsd: number, invoiceCurrency: string, invoiceTotal: number, fxRate: number, fxSource: string, tenorSecs: number, security: string): DraftTerms {
  const cost = parseAmount(costUsd.toFixed(2));
  const bps = (b: number) => ((cost * BigInt(b)) / 10000n).toString();
  return {
    cost: cost.toString(),
    markup: bps(svc.env.MARKUP_BPS),
    platform_fee: bps(svc.env.PLATFORM_FEE_BPS),
    late_fee: bps(svc.env.LATE_FEE_BPS),
    security,
    security_bps: svc.env.MIN_SECURITY_BPS,
    deposit_bps: svc.env.SUPPLIER_DEPOSIT_BPS,
    tenor_secs: tenorSecs,
    accept_window_secs: svc.env.ACCEPT_WINDOW_SECS,
    funding_window_secs: svc.env.FUNDING_WINDOW_SECS,
    invoice_total: invoiceTotal.toFixed(2),
    invoice_currency: invoiceCurrency,
    fx_rate: fxRate,
    fx_source: fxSource,
  };
}

/** POST /deals/:id/promise (FLOWS 9): security from required_security, text from the shared template. */
export async function buildPromise(svc: Services, deal: DealRow, importerWallet: string, importerName: string) {
  if (!['approved', 'review', 'promised'].includes(deal.status) || !deal.listingFingerprint) throw new ApiError(409, 'not_approved', 'the deal must pass verification before the promise');
  const terms = deal.terms as DraftTerms | null;
  if (!terms?.cost) throw new ApiError(409, 'no_terms', 'the invoice total is not known yet');
  const cost = BigInt(terms.cost);
  const security = await svc.chain.requiredSecurity(importerWallet, cost);
  const securityBps = Number((security * 10000n + cost - 1n) / cost);
  const supplier = deal.supplierId ? await svc.db.query.suppliers.findFirst({ where: eq(suppliers.id, deal.supplierId) }) : null;
  const text = renderPromiseText({
    importerName,
    importerAddress: importerWallet,
    entityName: svc.env.QAFILA_ENTITY_NAME,
    dealNumber: deal.number,
    goodsSummary: deal.goodsSummary,
    supplierName: supplier?.nameEn ?? 'the supplier',
    cost,
    markup: BigInt(terms.markup),
    security,
    securityBps,
    tenorDays: Math.max(1, Math.round(terms.tenor_secs / 86400)),
    acceptWindowDays: Math.max(1, Math.round(terms.accept_window_secs / 86400)),
    tokenCode: svc.env.SETTLEMENT_TOKEN_CODE,
    listingFingerprintHex: deal.listingFingerprint,
  });
  const textHash = toHex(sha256(text));
  const existing = await svc.db.query.promises.findFirst({ where: and(eq(promises.dealId, deal.id), eq(promises.textHash, textHash)) });
  if (!existing) await svc.db.insert(promises).values({ dealId: deal.id, listingFingerprint: deal.listingFingerprint, text, textHash, templateVersion: PROMISE_TEMPLATE_VERSION, security: security.toString(), securityBps });
  await svc.db.update(deals).set({ terms: { ...terms, security: security.toString(), security_bps: securityBps }, status: deal.status === 'review' ? deal.status : 'promised', security: security.toString(), updatedAt: new Date() }).where(eq(deals.id, deal.id));
  return { text, textHash, listingFingerprint: deal.listingFingerprint, security: security.toString(), securityBps, cost: terms.cost, templateVersion: PROMISE_TEMPLATE_VERSION };
}

/** POST /ops/deals/:id/list: promise on-chain, factory, LIST attestation, list_deal. */
export async function listDealOnChain(svc: Services, deal: DealRow, actor: string | null) {
  if (deal.onchainId) throw new ApiError(409, 'already_listed', `deal is already listed on-chain as ${deal.onchainId}`);
  if (!deal.listingFingerprint || !deal.reportId) throw new ApiError(409, 'not_verified', 'the deal has no approved report');
  const report = await svc.db.query.reports.findFirst({ where: eq(reports.id, deal.reportId) });
  if (!report) throw new ApiError(409, 'not_verified', 'report missing');
  if (report.decision === 'reject') throw new ApiError(409, 'rejected', 'a rejected deal cannot be listed');
  if (report.decision === 'review' && !(deal.terms as { ops_override?: boolean } | null)?.ops_override) throw new ApiError(409, 'needs_override', 'the report is under review: override it with a reason first');
  const importer = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, deal.importerId) });
  if (!importer?.walletAddress) throw new ApiError(409, 'no_wallet', 'the importer has no wallet linked');
  const supplier = deal.supplierId ? await svc.db.query.suppliers.findFirst({ where: eq(suppliers.id, deal.supplierId) }) : null;
  if (!supplier?.payoutAddress) throw new ApiError(409, 'no_payout_address', 'the supplier has no payout address on record');
  const promise = await svc.db.query.promises.findFirst({ where: eq(promises.dealId, deal.id), orderBy: desc(promises.createdAt) });
  if (!promise) throw new ApiError(409, 'no_promise', 'the importer has not generated the purchase promise');
  const onchainPromise = await svc.chain.getPromise(deal.listingFingerprint);
  if (!onchainPromise) throw new ApiError(409, 'promise_not_onchain', 'the importer has not signed promise_purchase on-chain yet');
  if (onchainPromise.importer !== importer.walletAddress || onchainPromise.promiseHash !== promise.textHash) throw new ApiError(409, 'promise_mismatch', 'the on-chain promise does not match the stored text or wallet');
  if (onchainPromise.listed) throw new ApiError(409, 'already_listed', 'this promise is already listed');
  const terms = deal.terms as DraftTerms;
  // Importer limit (PLAN 3.3.4 list_deal): say by how much the deal is over before spending rent on the factory (FLOWS 5.1).
  const [limit, stats] = await Promise.all([svc.chain.importerLimit(importer.walletAddress).catch(() => null), svc.chain.importerStats(importer.walletAddress).catch(() => null)]);
  if (limit !== null && stats) {
    const exposure = BigInt(stats.open_exposure) + BigInt(terms.cost);
    if (stats.defaulted > 0) throw new ApiError(409, 'importer_in_default', 'the importer has a default on record; the contract will not list a new deal');
    if (exposure > limit) throw new ApiError(409, 'limit_exceeded', `this deal (${formatAmount(terms.cost, svc.env.SETTLEMENT_TOKEN_CODE)}) plus the importer's open exposure (${formatAmount(stats.open_exposure, svc.env.SETTLEMENT_TOKEN_CODE)}) is ${formatAmount(exposure - limit, svc.env.SETTLEMENT_TOKEN_CODE)} over the importer's limit of ${formatAmount(limit, svc.env.SETTLEMENT_TOKEN_CODE)}; split the order or wait for an open deal to be repaid`, { cost: terms.cost, openExposure: stats.open_exposure, limit: limit.toString() });
  }
  const settlement = svc.env.SETTLEMENT_TOKEN_ID ?? (await import('../env.js')).loadDeployment(svc.env.STELLAR_NETWORK).settlementToken?.id;
  if (!settlement) throw new ApiError(503, 'no_settlement_token', 'SETTLEMENT_TOKEN_ID is not configured');
  if (!svc.verifierSecret || !svc.contractId) throw new ApiError(503, 'no_verifier', 'VERIFIER_ED25519_SECRET or the contract id is missing');

  let share: { sacId: string; issuerPublicKey: string; txHashes: string[]; locked: boolean };
  if (deal.shareToken && deal.issuerPublicKey) {
    share = { sacId: deal.shareToken, issuerPublicKey: deal.issuerPublicKey, txHashes: deal.factoryTxHashes ?? [], locked: true };
    log.info({ deal: deal.id, shareToken: deal.shareToken }, 'reusing the share token from an earlier listing attempt');
  } else {
    share = await svc.chain.createShareToken(deal.number);
    await svc.db.update(deals).set({ shareToken: share.sacId, issuerPublicKey: share.issuerPublicKey, factoryTxHashes: share.txHashes, updatedAt: new Date() }).where(eq(deals.id, deal.id));
  }
  const now = Math.floor(Date.now() / 1000);
  const dealTerms: DealTerms = DealTermsSchema.parse({
    importer: importer.walletAddress,
    supplier: supplier.payoutAddress,
    share_token: share.sacId,
    payout_token: settlement,
    cost: terms.cost,
    deposit_bps: terms.deposit_bps,
    markup: terms.markup,
    platform_fee: terms.platform_fee,
    late_fee: terms.late_fee,
    funding_deadline: now + terms.funding_window_secs,
    accept_window_secs: terms.accept_window_secs,
    tenor_secs: terms.tenor_secs,
    listing_fingerprint: deal.listingFingerprint,
    report_hash: report.hash,
    promise_hash: promise.textHash,
    halal_ok: true,
    payment_mode: 'Native',
    security: onchainPromise.security.toString(),
  });
  const xdrBytes = svc.chain.dealTermsXdr(dealTerms);
  const { signature } = signList({ verifierSecret: svc.verifierSecret, contractId: svc.contractId, networkPassphrase: svc.env.NETWORK_PASSPHRASE, dealTermsXdr: xdrBytes });
  const listed = await svc.chain.listDeal(dealTerms, signature);
  await svc.db.update(deals).set({ onchainId: listed.dealId, status: 'listed', shareToken: share.sacId, issuerPublicKey: share.issuerPublicKey, factoryTxHashes: [...share.txHashes, listed.txHash], terms: { ...terms, onchain: dealTerms }, security: dealTerms.security, updatedAt: new Date() }).where(eq(deals.id, deal.id));
  await svc.db.update(promises).set({ onchainTxHash: promise.onchainTxHash ?? listed.txHash, signedAt: promise.signedAt ?? new Date(onchainPromise.at * 1000) }).where(eq(promises.id, promise.id));
  await audit(svc.db, { actor, action: 'list_deal', target: deal.id, after: { onchainId: listed.dealId, txHash: listed.txHash, shareToken: share.sacId } });
  await enqueue(svc.db, 'notify', { kind: 'deal_listed', dealId: deal.id });
  return { onchainId: listed.dealId, txHash: listed.txHash, shareToken: share.sacId, issuerPublicKey: share.issuerPublicKey, factoryTxHashes: share.txHashes, terms: dealTerms };
}

export function abortFault(reason: AbortReason, requested: boolean | undefined, note: string): boolean {
  const def = ABORT_REASONS[reason].atFault;
  if (requested !== undefined && requested !== def && note.trim().length < 10) throw new ApiError(422, 'note_required', 'changing "at fault" needs a note of at least 10 characters');
  return requested ?? def;
}

export async function abortDeal(svc: Services, deal: DealRow, actor: string | null, reason: AbortReason, requestedFault: boolean | undefined, note: string) {
  if (!deal.onchainId) throw new ApiError(409, 'not_onchain', 'the deal is not listed on-chain');
  const atFault = abortFault(reason, requestedFault, note);
  const before = await svc.chain.getDeal(deal.onchainId);
  const tx = await svc.chain.abortDeal(deal.onchainId, atFault);
  const after = await svc.chain.getDeal(deal.onchainId);
  await svc.db.update(deals).set({ status: after ? ONCHAIN_STATUS[after.state] : deal.status, abortReason: reason, abortNote: note, updatedAt: new Date() }).where(eq(deals.id, deal.id));
  await audit(svc.db, { actor, action: 'abort_deal', target: deal.id, before: { state: before?.state }, after: { state: after?.state, reason, importerAtFault: atFault, txHash: tx.txHash }, reason: note });
  await enqueue(svc.db, 'notify', { kind: atFault ? 'security_used' : 'security_refunded', dealId: deal.id, reason: ABORT_REASONS[reason].label });
  await enqueue(svc.db, 'agent_tick', { reason: 'abort', dealId: deal.id }, { dedupeKey: `agent_tick:${deal.id}:abort` });
  return { txHash: tx.txHash, importerAtFault: atFault, state: after?.state ?? null };
}

export async function openIncident(db: Db, dealId: string | null, kind: string, detail: string): Promise<boolean> {
  const open = dealId ? await db.query.incidents.findFirst({ where: and(eq(incidents.dealId, dealId), eq(incidents.kind, kind), eq(incidents.status, 'open')) }) : null;
  if (open) return false;
  await db.insert(incidents).values({ dealId, kind, detail });
  await enqueue(db, 'notify', { kind: 'incident', dealId, incident: kind, detail });
  return true;
}

// ---------------------------------------------------------------- mappers

function routeOf(deal: DealRow) {
  const r = deal.route as { originPort: string; originCountry?: string; destinationPort: string; destinationCountry: string };
  const o = PORTS[r.originPort.toLowerCase().replace(/[^a-z]/g, '')] ?? PORTS[(r.originPort.split(/[ (,]/)[0] ?? '').toLowerCase()] ?? null;
  const d = PORTS[r.destinationPort.toLowerCase().replace(/[^a-z]/g, '')] ?? PORTS[(r.destinationPort.split(/[ (,]/)[0] ?? '').toLowerCase()] ?? null;
  return { originPort: r.originPort, originCountry: r.originCountry ?? 'CN', destinationPort: r.destinationPort, destinationCountry: r.destinationCountry, originLngLat: o, destinationLngLat: d };
}

export async function toSummary(svc: Services, deal: DealRow, onchain: OnchainDeal | null, report: { decision: string; riskScore: number } | null, importerStats: DealSummary['importerHistory']): Promise<DealSummary> {
  const t = (deal.terms ?? {}) as Partial<DraftTerms>;
  return {
    id: deal.id,
    number: deal.number,
    onchainId: deal.onchainId,
    status: onchain ? ONCHAIN_STATUS[onchain.state] : deal.status,
    state: onchain?.state ?? null,
    goodsSummary: deal.goodsSummary,
    route: routeOf(deal),
    cost: onchain?.terms.cost ?? t.cost ?? '0',
    markup: onchain?.terms.markup ?? t.markup ?? '0',
    platformFee: onchain?.terms.platform_fee ?? t.platform_fee ?? '0',
    security: onchain?.terms.security ?? deal.security ?? t.security ?? '0',
    tenorSecs: onchain?.terms.tenor_secs ?? t.tenor_secs ?? 0,
    funded: onchain?.funded ?? '0',
    fundingDeadline: onchain?.terms.funding_deadline ?? null,
    decision: (report?.decision as DealSummary['decision']) ?? null,
    riskScore: report?.riskScore ?? null,
    importerHistory: importerStats,
    shareToken: deal.shareToken ?? null,
    createdAt: deal.createdAt.toISOString(),
  };
}

export async function toDetail(svc: Services, deal: DealRow): Promise<DealDetail> {
  const onchain = deal.onchainId ? await svc.chain.getDeal(deal.onchainId).catch(() => null) : null;
  const latestReportId = deal.blReportId ?? deal.reportId;
  const report = latestReportId ? await svc.db.query.reports.findFirst({ where: eq(reports.id, latestReportId) }) : null;
  const importer = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, deal.importerId) });
  const stats = importer?.walletAddress ? await svc.chain.importerStats(importer.walletAddress).catch(() => null) : null;
  const summary = await toSummary(svc, deal, onchain, report ? { decision: report.decision, riskScore: report.riskScore } : null, stats);
  const checks = report ? await svc.db.query.checks.findMany({ where: eq(checksTable.reportId, report.id) }) : [];
  const events = deal.onchainId ? await svc.db.query.onchainEvents.findMany({ where: eq(onchainEvents.dealOnchainId, deal.onchainId), orderBy: desc(onchainEvents.ledger) }) : [];
  const shipment = await svc.db.query.shipments.findFirst({ where: eq(shipments.dealId, deal.id) });
  const cost = BigInt(summary.cost || '0');
  const security = BigInt(summary.security || '0');
  type Payment = DealDetail['payments'][number];
  const payments: Payment[] = events
    .map((e): Payment | null => {
      const d = e.data as Record<string, unknown>;
      const amount = String(d['amount'] ?? d['balance'] ?? d['payout'] ?? d['security'] ?? '0');
      const kind = ({ deposit_paid: 'supplier_deposit', shipment_confirmed: 'supplier_balance', promised: 'security_locked', security_applied: 'security_applied', refunded: 'security_refunded', repaid: 'repayment', late_fee_to_charity: 'late_fee', claimed: 'claim', recovery: 'recovery', swept: 'sweep' } as Record<string, DealDetail['payments'][number]['kind']>)[e.eventType];
      return kind ? { kind, amount: /^-?\d+$/.test(amount) ? amount : '0', txHash: e.txHash, at: (e.ledgerClosedAt ?? e.createdAt).toISOString() } : null;
    })
    .filter((p): p is Payment => p !== null);
  return {
    ...summary,
    onchain,
    publicReport: report
      ? { stage: report.stage as 'listing' | 'shipment', decision: report.decision as DealDetail['decision'] & string, riskScore: report.riskScore, reportHash: report.hash, signature: report.signature, checks: checks.map((c) => ({ name: c.name, status: c.status, severity: c.severity, detail: ((c.evidence as { detail?: string } | null)?.detail ?? '') })), adapterModes: (report.adapterModes as Record<string, string>) ?? {}, createdAt: report.createdAt.toISOString() }
      : null,
    tracking: shipment?.events && Array.isArray(shipment.events) && (shipment.events as unknown[]).length
      ? { mode: (shipment.mode as 'live' | 'mock') ?? 'mock', statusCode: shipment.statusCode, status: null, vessel: shipment.vessel, imo: shipment.imo, pol: shipment.pol, pod: shipment.pod, departure: shipment.departure?.toISOString() ?? null, arrival: shipment.arrival?.toISOString() ?? null, containers: shipment.containerNumbers, events: shipment.events as DealDetail['tracking'] extends infer T ? (T extends { events: infer E } ? E : never) : never, lastPolledAt: shipment.lastPolledAt?.toISOString() ?? null }
      : null,
    timeline: events.map((e) => ({ txHash: e.txHash, ledger: e.ledger, type: e.eventType, data: e.data as Record<string, unknown>, at: (e.ledgerClosedAt ?? e.createdAt).toISOString() })),
    payments,
    issuer: deal.issuerPublicKey ? { publicKey: deal.issuerPublicKey, locked: true, flags: ['AUTH_REQUIRED', 'AUTH_REVOCABLE', 'AUTH_CLAWBACK_ENABLED'] } : null,
    escrowId: deal.escrowId ?? null,
    lossOrder: ["The importer's own money: the security deposit, and after the sale everything they have paid.", 'Recoveries: from the supplier, insurance, resale of the goods, legal collection.', `Investors pro rata, ${svc.env.QAFILA_ENTITY_NAME}'s own ${(svc.env.COINVEST_BPS / 100).toFixed(0)}% included.`],
    worstCase: { investorRecoveryBps: cost > 0n ? Number((security * 10000n) / cost) : 0, note: cost > 0n ? `If the importer pays nothing after buying and nothing is recovered, investors get back the deposit's share: ${(Number((security * 10000n) / cost) / 100).toFixed(1)}% of what they put in.` : 'Amounts are not known yet.' },
    localCurrency: await localCurrency(svc, deal, cost, cost + BigInt(summary.markup || '0')),
  };
}

const LOCAL_CURRENCY: Record<string, string> = { NG: 'NGN', KE: 'KES', GH: 'GHS', TZ: 'TZS', EG: 'EGP', MA: 'MAD', PT: 'EUR', FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', GB: 'GBP', CH: 'CHF', CA: 'CAD', BR: 'BRL', MX: 'MXN', TH: 'THB', AR: 'ARS' };

/** S3 (PLAN 10.4): Reflector first, ECB second; hidden when neither covers the currency. */
export async function localCurrency(svc: Services, deal: DealRow, cost: bigint, salePrice: bigint): Promise<DealDetail['localCurrency']> {
  if (!svc.env.FF_REFLECTOR || cost <= 0n) return null;
  const route = deal.route as { destinationCountry?: string };
  const code = LOCAL_CURRENCY[(route.destinationCountry ?? '').toUpperCase()];
  if (!code || code === 'USD') return null;
  const fx = await usdRate(code, svc.adapters, true).catch(() => null);
  if (!fx || fx.rate <= 0 || fx.source === 'none') return null;
  // fx.rate = USD per 1 unit of `code`; amounts are in settlement units (USD-pegged), 7 decimals
  const perUsd = 1 / fx.rate;
  const conv = (v: bigint) => ((v * BigInt(Math.round(perUsd * 1_000_000))) / 1_000_000n).toString();
  return { code, cost: conv(cost), salePrice: conv(salePrice), rate: Number(perUsd.toFixed(6)), source: fx.source, at: new Date().toISOString() };
}

export async function dealsForList(svc: Services, where: { statuses?: string[]; importerId?: string; all?: boolean }) {
  const rows = await svc.db.query.deals.findMany({
    where: where.importerId ? eq(deals.importerId, where.importerId) : where.statuses?.length ? inArray(deals.status, where.statuses) : undefined,
    orderBy: desc(deals.createdAt),
    limit: 200,
  });
  const out: DealSummary[] = [];
  for (const d of rows) {
    if (!where.all && !where.importerId && ['draft', 'verifying', 'rejected', 'review', 'approved', 'promised'].includes(d.status)) continue;
    const onchain = d.onchainId ? await svc.chain.getDeal(d.onchainId).catch(() => null) : null;
    const report = d.reportId ? await svc.db.query.reports.findFirst({ where: eq(reports.id, d.reportId), columns: { decision: true, riskScore: true } }) : null;
    out.push(await toSummary(svc, d, onchain, report ?? null, null));
  }
  return out;
}
