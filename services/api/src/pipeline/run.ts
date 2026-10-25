/**
 * Pipeline orchestrator (PLAN 5.2): intake, extraction, normalise and validate,
 * consistency, halal, price, registry, sanctions, tracking (shipment stage),
 * fingerprints, decision policy, canonical signed report, explanation. Stages run in
 * parallel where independent. Target under 60 s for three documents.
 */
import type { Check, DocumentType, VerificationReport } from '@qafila/shared';
import { VerificationReportSchema, riskScore } from '@qafila/shared';
import { logger } from '../lib/logger.js';
import { signReport } from './attest.js';
import { checkConsistency } from './consistency.js';
import { decide, type DecisionFacts } from './decide.js';
import { ingestDocument } from './documents.js';
import { explain } from './explain.js';
import { extractDocument, type ExtractionResult } from './extract.js';
import { listingFingerprintCheck, shipmentFingerprintCheck } from './fingerprint.js';
import { halalScreen } from './halal.js';
import { priceCheck } from './price.js';
import { registryStage } from './registry.js';
import { sanctionsStage } from './sanctions.js';
import { trackingStage } from './tracking.js';
import type { DealContext, ExtractedSet, IngestedInput, InputDocument, PipelineDeps, PipelineResult } from './types.js';
import { checkArithmetic, checkBuyer, checkConsignee, checkContainers, checkDates, checkFormats, checkQuantities, checkUscc, checkWeights, WEIGHTS } from './validators.js';

const log = logger.child({ module: 'pipeline' });

export interface RunOptions {
  stage: 'listing' | 'shipment';
  /** Reuse documents extracted at the listing stage (shipment stage). */
  priorExtracted?: Partial<ExtractedSet>;
  priorIngested?: IngestedInput[];
  explain?: boolean;
}

type Timer = { marks: Record<string, number>; start: (k: string) => () => void };
const timer = (): Timer => {
  const marks: Record<string, number> = {};
  return { marks, start: (k) => { const t = Date.now(); return () => { marks[k] = Date.now() - t; }; } };
};

export async function runPipeline(ctx: DealContext, inputs: InputDocument[], deps: PipelineDeps, opts: RunOptions): Promise<PipelineResult> {
  const t = timer();
  const total = t.start('total');
  const a = deps.adapters;
  const checks: Check[] = [];
  const models: VerificationReport['models'] = [];
  const fixtures = new Set<string>();
  const injection = new Set<string>();

  // Intake
  const endIntake = t.start('intake');
  const ingested: IngestedInput[] = [...(opts.priorIngested ?? [])];
  for (const d of inputs) {
    if (ingested.some((x) => x.type === d.type)) continue;
    const doc = await ingestDocument(d.bytes, d.mime);
    ingested.push({ type: d.type, filename: d.filename, doc });
  }
  endIntake();

  // Extraction (parallel per document)
  const endExtract = t.start('extract');
  const extracted: ExtractedSet = { invoice: null, packing_list: null, business_licence: null, bill_of_lading: null, ...(opts.priorExtracted ?? {}) };
  const toExtract = ingested.filter((i) => i.type !== 'kyb' && !extracted[i.type as keyof ExtractedSet]);
  const results = await Promise.all(toExtract.map((i) => extractDocument(i.type as Exclude<DocumentType, 'kyb'>, i.doc, ctx, a.llm, a.ctx.llm)));
  let extractionFailed = false;
  let minConf = 1;
  let missing = 0;
  const applyExtraction = (type: Exclude<DocumentType, 'kyb'>, r: ExtractionResult) => {
    (extracted as unknown as Record<string, unknown>)[type] = r.document;
    checks.push(...r.checks);
    models.push(r.model);
    if (r.fixture) fixtures.add(r.fixture);
    r.injection.forEach((x) => injection.add(x));
    if (!r.document) extractionFailed = true;
    minConf = Math.min(minConf, r.minKeyConfidence);
    missing += r.missingKeyFields.length;
  };
  toExtract.forEach((i, idx) => applyExtraction(i.type as Exclude<DocumentType, 'kyb'>, results[idx]!));
  endExtract();
  const inv = extracted.invoice;
  const pl = extracted.packing_list;
  const lic = extracted.business_licence;
  const bl = opts.stage === 'shipment' ? extracted.bill_of_lading : null;
  if (opts.stage === 'listing' && !inv) checks.push({ name: 'documents.required', status: 'fail', severity: 'critical', detail: 'No readable invoice.', weight: WEIGHTS.critical, fix: 'Upload the pro-forma or commercial invoice.' });
  if (opts.stage === 'shipment' && !bl) checks.push({ name: 'documents.required', status: 'fail', severity: 'critical', detail: 'No readable bill of lading.', weight: WEIGHTS.critical, fix: 'Upload the bill of lading.' });

  // Deterministic validators
  const endValidate = t.start('validate');
  const containerFields = [
    ...(pl?.container_numbers ?? []).map((c) => ({ value: c.value, document: 'packing_list' })),
    ...(bl?.containers ?? []).map((c) => ({ value: c.number.value, document: 'bill_of_lading' })),
    ...(opts.stage === 'shipment' && !bl?.containers.length ? (ctx.containers ?? []).map((c) => ({ value: c, document: 'form' })) : []),
  ];
  const containerChecks = checkContainers(containerFields);
  checks.push(...containerChecks);
  const usccCode = lic?.uscc.value ?? inv?.seller.uscc.value ?? ctx.supplier.uscc ?? null;
  const usccCheck = checkUscc(usccCode, lic ? 'business_licence' : 'invoice');
  if (opts.stage === 'listing' || lic) checks.push(usccCheck);
  const arithmetic = inv ? checkArithmetic(inv) : null;
  if (arithmetic) checks.push(...arithmetic.checks);
  const dates = checkDates(inv, pl, bl, deps.today);
  checks.push(dates);
  const weights = checkWeights(pl, bl);
  if (opts.stage === 'shipment') checks.push(weights.check);
  const quantities = checkQuantities(inv, pl);
  if (opts.stage === 'listing') checks.push(quantities);
  const formats = checkFormats(inv, ctx.incoterms);
  if (opts.stage === 'listing') checks.push(formats);
  const buyer = checkBuyer(inv, ctx.entityName, ctx.dealNumber);
  checks.push(buyer);
  const consignee = checkConsignee(bl, ctx.entityName, ctx.dealNumber, ctx.importer.name);
  checks.push(...consignee);
  endValidate();

  // Independent stages in parallel: consistency, halal, price, registry, sanctions (+tracking at shipment)
  const endStages = t.start('stages');
  const [consistency, halal, price, registry] = await Promise.all([
    checkConsistency(opts.stage, extracted, ctx, a.llm, a.ctx.llm),
    opts.stage === 'listing' ? halalScreen(inv, deps.policy, a.llm, a.ctx.llm) : Promise.resolve(null),
    opts.stage === 'listing' ? priceCheck(inv, deps.policy, a, { useReflector: a.modes['reflector'] !== 'off' }) : Promise.resolve(null),
    registryStage(lic, ctx, a),
  ]);
  const vessel = bl?.vessel.value ? { name: bl.vessel.value, imo: bl.imo.value } : null;
  const [sanctions, tracking] = await Promise.all([
    sanctionsStage({ supplier: { name: lic?.name_en.value ?? inv?.seller.name_en.value ?? ctx.supplier.nameEn, nameZh: lic?.name_zh.value ?? ctx.supplier.nameZh, country: 'cn' }, importer: { name: ctx.importer.name, country: ctx.importer.country }, legalRepresentative: registry.lookup?.legalRepresentative ?? lic?.legal_representative.value ?? null, vessel }, deps.policy, a),
    opts.stage === 'shipment' ? trackingStage(bl, ctx, a) : Promise.resolve(null),
  ]);
  endStages();
  for (const s of [consistency, halal, price, registry, sanctions, tracking]) {
    if (!s) continue;
    checks.push(...s.checks);
    if ('models' in s) models.push(...s.models);
    s.fixtures.forEach((f) => fixtures.add(f));
  }

  // Fingerprints
  const endFp = t.start('fingerprint');
  const listingFp = await listingFingerprintCheck(inv, ctx, deps.fingerprints);
  checks.push(listingFp.check);
  const shipmentFp = opts.stage === 'shipment' ? await shipmentFingerprintCheck(bl, ctx, deps.fingerprints) : null;
  if (shipmentFp) checks.push(shipmentFp.check);
  endFp();

  if (injection.size) checks.push({ name: 'document.hidden_text', status: 'fail', severity: 'info', detail: `Hidden or AI-addressed text found and ignored: ${[...injection].map((s) => `"${s.slice(0, 120)}"`).join('; ')}.`, weight: WEIGHTS.info, evidence: [...injection] });

  // Decision policy (pure)
  const facts: DecisionFacts = {
    stage: opts.stage,
    containerCheckDigitsValid: containerChecks[0]?.status === 'skipped' ? null : containerChecks[0]?.status === 'pass',
    usccCheckDigitValid: usccCode ? usccCheck.status === 'pass' : null,
    registry: { ...registry.facts, source: registry.registry.source, opsOverride: Boolean(ctx.registryOverride) },
    maxSanctionsScore: sanctions.maxScore,
    sanctionsAvailable: sanctions.available,
    halalVerdicts: halal?.lines.map((l) => l.verdict) ?? [],
    listingFingerprintUsed: listingFp.used,
    shipmentFingerprintUsed: shipmentFp?.used ?? false,
    arithmeticOffPct: arithmetic ? (arithmetic.totalErrorPct === null && arithmetic.maxLineErrorPct === null ? null : Math.max(arithmetic.maxLineErrorPct ?? 0, arithmetic.totalErrorPct ?? 0)) : null,
    weightMismatchPct: opts.stage === 'shipment' ? weights.mismatchPct : null,
    priceRatios: price?.price.map((p) => p.ratio_to_mid) ?? [],
    consistency: consistency.judgments.map((j) => j.match),
    tracking: tracking ? tracking.facts : null,
    minKeyFieldConfidence: minConf,
    missingKeyFields: missing,
    extractionFailed,
    dealStructureOk: buyer.status === 'pass' && consignee.every((c) => c.status === 'pass'),
    datesOk: dates.status === 'pass',
    quantitiesMatch: opts.stage === 'listing' ? (quantities.status === 'skipped' ? null : quantities.status === 'pass') : null,
    thresholds: deps.policy.thresholds,
  };
  const decision = decide(facts);
  checks.push({ name: 'decision.policy', status: 'pass', severity: 'info', detail: `${decision.decision} by policy 5.6: ${decision.reasons.length ? decision.reasons.map((r) => `${r.level}:${r.rule}`).join(', ') : 'no flags'}.`, weight: 0, evidence: decision.reasons });

  const cost = Number(models.reduce((s, m) => s + m.cost_usd, 0).toFixed(6));
  const adapterModes: VerificationReport['adapter_modes'] = {
    llm: a.modes['llm'] === 'off' ? 'unavailable' : (a.modes['llm'] as 'live' | 'mock'),
    registry: registry.registry.mode,
    opensanctions: sanctions.available ? (a.modes['opensanctions'] as 'live' | 'mock') : 'unavailable',
    shipsgo: opts.stage === 'shipment' ? (tracking?.tracking ? tracking.tracking.mode : 'unavailable') : 'skipped',
    reflector: price?.fx?.source === 'reflector' ? (a.modes['reflector'] === 'mock' ? 'mock' : 'live') : 'skipped',
    fx: price?.fx?.source === 'ecb' ? (a.modes['fx'] as 'live' | 'mock') : 'skipped',
  };

  const draft: VerificationReport = {
    version: '1.1',
    stage: opts.stage,
    deal_ref: ctx.dealRef,
    created_at: new Date().toISOString(),
    decision: decision.decision,
    risk_score: riskScore(checks),
    checks,
    extracted,
    registry: registry.registry,
    sanctions: sanctions.sanctions,
    tracking: tracking?.tracking ?? null,
    price: price?.price ?? [],
    halal: halal?.lines ?? [],
    consistency: consistency.judgments,
    listing_fingerprint: listingFp.hex,
    shipment_fingerprint: shipmentFp?.hex ?? null,
    document_hashes: ingested.map((i) => ({ type: i.type, sha256: i.doc.sha256 })),
    models,
    adapter_modes: adapterModes,
    fixtures_used: [...fixtures].sort(),
    timings_ms: {},
    cost_usd: cost,
    injection_attempts: [...injection],
    explanation: null,
  };

  if (opts.explain !== false) {
    const endExplain = t.start('explain');
    const e = await explain(decision.decision, checks, a.llm, a.ctx.llm, `explain:${ctx.dealRef}:${opts.stage}:${draft.listing_fingerprint ?? 'nofp'}:${checks.map((c) => `${c.name}=${c.status}`).join(',')}`);
    endExplain();
    if (e.model) draft.models.push(e.model);
    if (e.fixture) draft.fixtures_used = [...new Set([...draft.fixtures_used, e.fixture])].sort();
    draft.explanation = [e.explanation.summary, ...(e.explanation.fixes.length ? ['', 'What to fix:', ...e.explanation.fixes.map((f) => `- ${f}`)] : []), ...(e.explanation.category ? ['', `Category: ${e.explanation.category.replace('_', ' ')}`] : [])].join('\n');
    draft.cost_usd = Number(draft.models.reduce((s, m) => s + m.cost_usd, 0).toFixed(6));
  }
  total();
  draft.timings_ms = { ...t.marks };
  const report = VerificationReportSchema.parse(draft);
  const signed = signReport(report, { verifierSecret: deps.verifierSecret, contractId: deps.contractId, networkPassphrase: deps.networkPassphrase });
  log.info({ deal: ctx.dealRef, stage: opts.stage, decision: report.decision, risk: report.risk_score, ms: t.marks['total'], cost: report.cost_usd, hash: signed.reportHash.slice(0, 12) }, 'pipeline done');
  return { report, reportHash: signed.reportHash, canonical: signed.canonical, signature: signed.signature, verifierPublicKey: signed.verifierPublicKey, extracted, ingested };
}
