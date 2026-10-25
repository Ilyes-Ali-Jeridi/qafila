/**
 * Cross-document consistency (PLAN 5.2): deterministic comparisons first (normalised
 * Chinese names, container numbers, invoice references), then one batched LLM judge
 * call for the pairs that need language understanding (goods descriptions across
 * languages, name variants). Each judgment carries both evidence quotes.
 */
import { z } from 'zod';
import { ConsistencyJudgmentSchema, type Check } from '@qafila/shared';
import type { AdapterContext } from '../adapters/base.js';
import type { LlmClient } from '../adapters/llm.js';
import { coreEnName, normaliseContainer, normaliseEnName, normaliseVessel, normaliseZhName } from './normalise.js';
import { loadPrompt } from './prompts/index.js';
import type { DealContext, ExtractedSet, ModelCall } from './types.js';
import { WEIGHTS } from './validators.js';

export type Judgment = z.infer<typeof ConsistencyJudgmentSchema>;

export interface ConsistencyResult {
  judgments: Judgment[];
  checks: Check[];
  models: ModelCall[];
  fixtures: string[];
}

interface Pair {
  field: string;
  what: string;
  a: string;
  aSource: string;
  b: string;
  bSource: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  fix: string;
}

const JudgeOutput = z.object({ judgments: z.array(ConsistencyJudgmentSchema).min(1) });

function deterministic(field: string, what: string, a: string, b: string, equal: boolean, severity: Pair['severity'], fix: string, aSource: string, bSource: string): { judgment: Judgment; check: Check } {
  const judgment: Judgment = { field, match: equal ? 'yes' : 'no', reason: equal ? `${what}: identical after normalisation.` : `${what}: differ after normalisation.`, evidence_a: a, evidence_b: b };
  const check: Check = equal
    ? { name: `consistency.${field}`, status: 'pass', severity, detail: `${what} match (${aSource} vs ${bSource}).`, weight: WEIGHTS[severity], evidence: { a, b } }
    : { name: `consistency.${field}`, status: 'review', severity, detail: `${what} differ: "${a}" (${aSource}) vs "${b}" (${bSource}).`, weight: WEIGHTS[severity], evidence: { a, b }, document: bSource, field, fix };
  return { judgment, check };
}

export async function checkConsistency(stage: 'listing' | 'shipment', ex: ExtractedSet, ctx: DealContext, llm: LlmClient, llmCtx: AdapterContext): Promise<ConsistencyResult> {
  const judgments: Judgment[] = [];
  const checks: Check[] = [];
  const pairs: Pair[] = [];
  const inv = ex.invoice;
  const pl = ex.packing_list;
  const lic = ex.business_licence;
  const bl = ex.bill_of_lading;

  // Seller on the invoice vs the business licence: Chinese exact after normalisation; English by judge when not equal.
  if (inv && lic) {
    const zhA = inv.seller.name_zh.value;
    const zhB = lic.name_zh.value;
    if (zhA && zhB) {
      const r = deterministic('seller_name_zh', 'Seller Chinese name on the invoice and the licence', zhA, zhB, normaliseZhName(zhA) === normaliseZhName(zhB), 'high', 'The invoice must be issued by the licensed company; names must match character for character.', 'invoice', 'business_licence');
      judgments.push(r.judgment);
      checks.push(r.check);
    }
    const enA = inv.seller.name_en.value;
    const enB = lic.name_en.value;
    if (enA && enB) {
      if (normaliseEnName(enA) === normaliseEnName(enB) || coreEnName(enA) === coreEnName(enB)) {
        const r = deterministic('seller_name_en', 'Seller English name on the invoice and the licence', enA, enB, true, 'medium', '', 'invoice', 'business_licence');
        judgments.push(r.judgment);
        checks.push(r.check);
      } else pairs.push({ field: 'seller_name_en', what: 'Seller English name on the invoice vs the English name on the business licence', a: enA, aSource: 'invoice', b: enB, bSource: 'business_licence', severity: 'medium', fix: 'The English name on the invoice should match the licence (or its official translation).' });
    } else if (!zhA && !zhB) {
      checks.push({ name: 'consistency.seller_name', status: 'review', severity: 'high', detail: 'Neither document shows a seller name that can be compared.', weight: WEIGHTS.high, document: 'invoice', field: 'seller', fix: 'The invoice must show the seller company name and the licence its registered name.' });
    }
    const usccA = inv.seller.uscc.value;
    const usccB = lic.uscc.value;
    if (usccA && usccB) {
      const r = deterministic('seller_uscc', 'Unified Social Credit Code on the invoice and the licence', usccA, usccB, usccA.toUpperCase().trim() === usccB.toUpperCase().trim(), 'high', 'The code on the invoice must equal the code on the licence.', 'invoice', 'business_licence');
      judgments.push(r.judgment);
      checks.push(r.check);
    }
  }

  // Supplier declared on the form vs the licence.
  if (lic) {
    const formZh = ctx.supplier.nameZh;
    const licZh = lic.name_zh.value;
    if (formZh && licZh) {
      const r = deterministic('form_supplier_zh', 'Supplier Chinese name on the form and the licence', formZh, licZh, normaliseZhName(formZh) === normaliseZhName(licZh), 'medium', 'Enter the supplier name exactly as on the licence.', 'form', 'business_licence');
      judgments.push(r.judgment);
      checks.push(r.check);
    } else if (lic.name_en.value && !(coreEnName(ctx.supplier.nameEn) === coreEnName(lic.name_en.value))) {
      pairs.push({ field: 'form_supplier_en', what: 'Supplier English name entered on the deal form vs the licence', a: ctx.supplier.nameEn, aSource: 'form', b: lic.name_en.value, bSource: 'business_licence', severity: 'medium', fix: 'Enter the supplier name as on the licence.' });
    }
  }

  // Packing list vs invoice: reference, seller, goods.
  if (inv && pl) {
    const refA = inv.invoice_number.value;
    const refB = pl.invoice_number.value;
    if (refA && refB) {
      const r = deterministic('invoice_reference', 'Invoice number on the invoice and the packing list', refA, refB, refA.trim().toUpperCase() === refB.trim().toUpperCase(), 'high', 'The packing list must reference this invoice number.', 'invoice', 'packing_list');
      judgments.push(r.judgment);
      checks.push(r.check);
    }
    const n = Math.min(inv.line_items.length, pl.items.length);
    const descA = inv.line_items.slice(0, n).map((l, i) => `${i + 1}. ${l.description_en.value ?? ''} ${l.description_zh.value ?? ''}`.trim()).join(' | ');
    const descB = pl.items.slice(0, n).map((l, i) => `${i + 1}. ${l.description_en.value ?? ''}`.trim()).join(' | ');
    if (n > 0) pairs.push({ field: 'goods_invoice_vs_packing_list', what: 'Goods descriptions line by line on the invoice vs the packing list (same order, same goods?)', a: descA, aSource: 'invoice', b: descB, bSource: 'packing_list', severity: 'high', fix: 'The packing list must list the same goods as the invoice.' });
  }

  if (stage === 'shipment' && bl) {
    // Shipper equals supplier (deterministic first, then judge).
    const shipperEn = bl.shipper.name_en.value;
    const shipperZh = bl.shipper.name_zh.value;
    const supplierEn = inv?.seller.name_en.value ?? ctx.supplier.nameEn;
    const supplierZh = inv?.seller.name_zh.value ?? ctx.supplier.nameZh ?? null;
    if (shipperZh && supplierZh) {
      const r = deterministic('shipper_vs_supplier', 'B/L shipper vs the supplier', shipperZh, supplierZh, normaliseZhName(shipperZh) === normaliseZhName(supplierZh), 'high', 'The B/L shipper must be the supplier that issued the invoice.', 'bill_of_lading', 'invoice');
      judgments.push(r.judgment);
      checks.push(r.check);
    } else if (shipperEn && supplierEn) {
      if (coreEnName(shipperEn) === coreEnName(supplierEn)) {
        const r = deterministic('shipper_vs_supplier', 'B/L shipper vs the supplier', shipperEn, supplierEn, true, 'high', '', 'bill_of_lading', 'invoice');
        judgments.push(r.judgment);
        checks.push(r.check);
      } else pairs.push({ field: 'shipper_vs_supplier', what: 'Shipper named on the B/L vs the supplier that issued the invoice', a: shipperEn, aSource: 'bill_of_lading', b: supplierEn, bSource: 'invoice', severity: 'high', fix: 'The B/L shipper must be the supplier that issued the invoice.' });
    } else checks.push({ name: 'consistency.shipper_vs_supplier', status: 'review', severity: 'high', detail: 'The B/L shipper could not be read.', weight: WEIGHTS.high, document: 'bill_of_lading', field: 'shipper', fix: 'Upload a B/L that shows the shipper.' });

    // Containers on the B/L vs the packing list (when the packing list lists them) and the form.
    const blContainers = bl.containers.map((c) => normaliseContainer(c.number.value)).filter(Boolean);
    const plContainers = (pl?.container_numbers ?? []).map((c) => normaliseContainer(c.value)).filter(Boolean);
    const formContainers = (ctx.containers ?? []).map(normaliseContainer);
    if (blContainers.length && (plContainers.length || formContainers.length)) {
      const ref = plContainers.length ? plContainers : formContainers;
      const refSource = plContainers.length ? 'packing_list' : 'form';
      const missing = ref.filter((c) => !blContainers.includes(c));
      const extra = blContainers.filter((c) => !ref.includes(c));
      const equal = missing.length === 0 && extra.length === 0;
      const r = deterministic('containers', `Container numbers on the B/L and the ${refSource.replace('_', ' ')}`, blContainers.join(', '), ref.join(', '), equal, 'high', 'The containers on the B/L must be the ones packed and declared.', 'bill_of_lading', refSource);
      judgments.push(r.judgment);
      checks.push(r.check);
    }

    // B/L number vs the form.
    if (ctx.blNumber && bl.bl_number.value) {
      const r = deterministic('bl_number', 'B/L number on the document and on the form', bl.bl_number.value, ctx.blNumber, bl.bl_number.value.replace(/\s/g, '').toUpperCase() === ctx.blNumber.replace(/\s/g, '').toUpperCase(), 'medium', 'Enter the B/L number exactly as printed.', 'bill_of_lading', 'form');
      judgments.push(r.judgment);
      checks.push(r.check);
    }

    // Goods on the B/L vs the invoice.
    if (inv && bl.description_of_goods.value) {
      pairs.push({ field: 'goods_bl_vs_invoice', what: 'Description of goods on the B/L vs the invoice line items (same goods?)', a: bl.description_of_goods.value, aSource: 'bill_of_lading', b: inv.line_items.map((l, i) => `${i + 1}. ${l.description_en.value ?? ''}`).join(' | '), bSource: 'invoice', severity: 'high', fix: 'The B/L must describe the invoiced goods.' });
    }

    // Port of loading on the B/L vs the invoice.
    if (inv?.port_of_loading.value && bl.port_of_loading.value) {
      const a = normaliseVessel(bl.port_of_loading.value);
      const b = normaliseVessel(inv.port_of_loading.value);
      const equal = a === b || a.split(' ')[0] === b.split(' ')[0];
      if (equal) {
        const r = deterministic('port_of_loading', 'Port of loading on the B/L and the invoice', bl.port_of_loading.value, inv.port_of_loading.value, true, 'medium', '', 'bill_of_lading', 'invoice');
        judgments.push(r.judgment);
        checks.push(r.check);
      } else pairs.push({ field: 'port_of_loading', what: 'Port of loading on the B/L vs the invoice', a: bl.port_of_loading.value, aSource: 'bill_of_lading', b: inv.port_of_loading.value, bSource: 'invoice', severity: 'medium', fix: 'The B/L port of loading should match the invoice terms.' });
    }
  }

  const models: ModelCall[] = [];
  const fixtures: string[] = [];
  if (pairs.length) {
    const prompt = loadPrompt('consistency');
    const res = await llm.structured({
      stage: `consistency.${stage}`,
      tier: 'reason',
      promptVersion: prompt.version,
      system: prompt.text,
      user: [{ text: `Comparisons (${pairs.length}):\n` + pairs.map((p, i) => `${i + 1}. field: ${p.field}\n   what: ${p.what}\n   A (${p.aSource}): ${p.a}\n   B (${p.bSource}): ${p.b}`).join('\n') }],
      schema: JudgeOutput,
      toolName: 'record_judgments',
      toolDescription: 'Record one judgment per comparison, in order.',
      maxTokens: 4000,
    }, llmCtx);
    models.push({ stage: `consistency.${stage}`, provider: res.provider, model_id: res.modelId, prompt_version: res.promptVersion, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: res.latencyMs, cost_usd: res.costUsd });
    if (res.fixture) fixtures.push(res.fixture);
    for (const p of pairs) {
      const j = res.data?.judgments.find((x) => x.field === p.field) ?? res.data?.judgments[pairs.indexOf(p)];
      if (!res.ok || !j) {
        judgments.push({ field: p.field, match: 'unsure', reason: `Judge unavailable: ${res.error ?? 'no answer'}`, evidence_a: p.a, evidence_b: p.b });
        checks.push({ name: `consistency.${p.field}`, status: 'unavailable', severity: p.severity, detail: `${p.what}: the judge did not answer.`, weight: WEIGHTS[p.severity], document: p.bSource, field: p.field });
        continue;
      }
      const judgment: Judgment = { ...j, field: p.field };
      judgments.push(judgment);
      checks.push(
        judgment.match === 'yes'
          ? { name: `consistency.${p.field}`, status: 'pass', severity: p.severity, detail: `${p.what}: match. ${judgment.reason}`, weight: WEIGHTS[p.severity], evidence: { a: judgment.evidence_a, b: judgment.evidence_b } }
          : { name: `consistency.${p.field}`, status: 'review', severity: p.severity, detail: `${p.what}: ${judgment.match}. ${judgment.reason}`, weight: WEIGHTS[p.severity], evidence: { a: judgment.evidence_a, b: judgment.evidence_b }, document: p.bSource, field: p.field, fix: p.fix },
      );
    }
  }
  return { judgments, checks, models, fixtures };
}
