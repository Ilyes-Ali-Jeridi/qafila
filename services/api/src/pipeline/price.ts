/**
 * Price check (PLAN 5.2, 10.4): the fast model maps each line to a category of
 * data/price_reference.csv; code converts the unit price to USD (Reflector first,
 * then ECB through frankfurter) and compares with the reference range. Ratio to the
 * midpoint outside 0.5x to 2x sends the deal to review.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Check, Invoice, PriceCheckSchema } from '@qafila/shared';
import type { Adapters } from '../adapters/index.js';
import { normaliseCurrency, normaliseUnit } from './normalise.js';
import { loadPrompt } from './prompts/index.js';
import type { HalalPolicy, ModelCall } from './types.js';
import { WEIGHTS } from './validators.js';

export type PriceCheck = z.infer<typeof PriceCheckSchema>;

export interface ReferenceRow {
  category: string;
  description: string;
  unit: string;
  low: number;
  high: number;
  hs_prefix: string;
  source_url: string;
  source_date: string;
}

export const PRICE_REFERENCE_PATH = resolve(import.meta.dirname, '../../../../data/price_reference.csv');

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

let cached: ReferenceRow[] | null = null;
export function loadPriceReference(path = PRICE_REFERENCE_PATH): ReferenceRow[] {
  if (cached && path === PRICE_REFERENCE_PATH) return cached;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]!);
  const idx = (k: string) => header.indexOf(k);
  const rows = lines.slice(1).map((l) => {
    const c = parseCsvLine(l);
    return { category: c[idx('category')]!, description: c[idx('description')]!, unit: c[idx('unit')]!, low: Number(c[idx('low_usd')]), high: Number(c[idx('high_usd')]), hs_prefix: c[idx('hs_prefix')]!, source_url: c[idx('source_url')]!, source_date: c[idx('source_date')]! };
  });
  if (path === PRICE_REFERENCE_PATH) cached = rows;
  return rows;
}

export interface FxQuote {
  from: string;
  rate: number; // 1 from = rate USD
  source: 'reflector' | 'ecb' | 'none';
}

/** 1 unit of `currency` in USD: Reflector (S3) first, then ECB; USD is 1. */
export async function usdRate(currency: string, adapters: Adapters, useReflector: boolean): Promise<FxQuote> {
  const cur = currency.toUpperCase();
  if (cur === 'USD') return { from: 'USD', rate: 1, source: 'none' };
  if (useReflector) {
    const r = await adapters.reflector({ symbol: cur }, adapters.ctx.reflector);
    if (r.status === 'ok' && r.data) return { from: cur, rate: r.data.usdPerUnit, source: 'reflector' };
  }
  const e = await adapters.fx({ from: cur, to: 'USD' }, adapters.ctx.fx);
  if (e.status === 'ok' && e.data) return { from: cur, rate: e.data.rate, source: 'ecb' };
  return { from: cur, rate: 0, source: 'none' };
}

export interface PriceResult {
  price: PriceCheck[];
  checks: Check[];
  models: ModelCall[];
  fixtures: string[];
  fx: FxQuote | null;
}

export async function priceCheck(inv: Invoice | null, policy: HalalPolicy, adapters: Adapters, opts: { useReflector: boolean }): Promise<PriceResult> {
  if (!inv || inv.line_items.length === 0) return { price: [], checks: [], models: [], fixtures: [], fx: null };
  const ref = loadPriceReference();
  const ids = ['none', ...ref.map((r) => r.category)] as [string, ...string[]];
  const Output = z.object({ lines: z.array(z.object({ line_index: z.number().int(), category: z.enum(ids), unit_matches: z.boolean(), unit_price_per_reference_unit: z.number().nullable(), note: z.string() })).min(1) });
  const prompt = loadPrompt('price');
  const table = ref.map((r) => `- ${r.category}: ${r.description}; reference unit: ${r.unit}; HS ${r.hs_prefix}`).join('\n');
  const items = inv.line_items.map((l, i) => `line_index ${i + 1}: ${l.description_en.value ?? ''}${l.description_zh.value ? ` / ${l.description_zh.value}` : ''}; HS ${l.hs_code.value ?? '?'}; quantity ${l.quantity.value ?? '?'} ${l.unit.value ?? ''}; unit price ${l.unit_price.value ?? '?'} ${inv.currency.value ?? ''} per ${l.unit.value ?? 'unit'}`).join('\n');
  const res = await adapters.llm.structured({
    stage: 'price',
    tier: 'fast',
    promptVersion: prompt.version,
    system: `${prompt.text}\n\nReference categories:\n${table}`,
    user: [{ text: `Line items:\n${items}` }],
    schema: Output,
    toolName: 'record_price_mapping',
    toolDescription: 'Record the reference category and unit handling of every line item.',
    maxTokens: 2500,
  }, adapters.ctx.llm);
  const models: ModelCall[] = [{ stage: 'price', provider: res.provider, model_id: res.modelId, prompt_version: res.promptVersion, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: res.latencyMs, cost_usd: res.costUsd }];
  const fixtures = res.fixture ? [res.fixture] : [];
  const currency = normaliseCurrency(inv.currency.value) ?? 'USD';
  const fx = await usdRate(currency, adapters, opts.useReflector);
  const price: PriceCheck[] = [];
  const checks: Check[] = [];
  if (!res.ok || !res.data) {
    checks.push({ name: 'price.mapping', status: 'unavailable', severity: 'medium', detail: `The price classification did not run: ${res.error ?? 'no answer'}.`, weight: WEIGHTS.medium });
    return { price, checks, models, fixtures, fx };
  }
  for (const [i, l] of inv.line_items.entries()) {
    const m = res.data.lines.find((x) => x.line_index === i + 1) ?? res.data.lines[i];
    const desc = l.description_en.value ?? l.description_zh.value ?? `line ${i + 1}`;
    const lineLabel = `${i + 1}. ${desc}`;
    const row = ref.find((r) => r.category === m?.category);
    const name = `price.${row ? row.category : `line_${i + 1}`}`;
    const unitPriceInvoice = l.unit_price.value;
    if (!row || !m || unitPriceInvoice === null) {
      price.push({ line: lineLabel, category: row?.category ?? null, unit_price_usd: null, reference_low_usd: null, reference_high_usd: null, ratio_to_mid: null, fx: null, status: 'skipped' });
      checks.push({ name, status: 'skipped', severity: 'low', detail: `Line ${i + 1} (${desc}): no reference category in the table${m?.note ? ` (${m.note})` : ''}.`, weight: 0 });
      continue;
    }
    const perRef = m.unit_matches || normaliseUnit(l.unit.value) === normaliseUnit(row.unit) ? unitPriceInvoice : m.unit_price_per_reference_unit;
    if (perRef === null || fx.rate === 0) {
      price.push({ line: lineLabel, category: row.category, unit_price_usd: null, reference_low_usd: row.low, reference_high_usd: row.high, ratio_to_mid: null, fx: fx.source === 'none' && currency !== 'USD' ? null : { from: fx.from, rate: fx.rate, source: fx.source }, status: 'unavailable' });
      checks.push({ name, status: 'unavailable', severity: 'medium', detail: fx.rate === 0 ? `Line ${i + 1}: no exchange rate for ${currency}, so the price could not be compared.` : `Line ${i + 1} (${desc}): the invoice unit "${l.unit.value}" could not be converted to the reference unit "${row.unit}".`, weight: WEIGHTS.medium, document: 'invoice', field: `line_items[${i}].unit` });
      continue;
    }
    const usd = perRef * fx.rate;
    const mid = (row.low + row.high) / 2;
    const ratio = usd / mid;
    const entry: PriceCheck = { line: lineLabel, category: row.category, unit_price_usd: Number(usd.toFixed(4)), reference_low_usd: row.low, reference_high_usd: row.high, ratio_to_mid: Number(ratio.toFixed(3)), fx: { from: fx.from, rate: fx.rate, source: fx.source }, status: 'pass' };
    const detailBase = `Line ${i + 1} (${desc}): ${usd.toFixed(2)} USD per ${row.unit} vs reference ${row.low} to ${row.high} (${row.category}, ${ratio.toFixed(2)}x the midpoint${currency !== 'USD' ? `, ${currency} converted at ${fx.rate.toFixed(4)} via ${fx.source}` : ''}).`;
    if (ratio < policy.thresholds.priceRatioLow || ratio > policy.thresholds.priceRatioHigh) {
      entry.status = 'review';
      checks.push({ name, status: 'review', severity: 'high', detail: detailBase, weight: WEIGHTS.high, evidence: entry, document: 'invoice', field: `line_items[${i}].unit_price`, fix: ratio > 1 ? 'The unit price is far above the reference: provide a reason (brand, specification) or a corrected quote.' : 'The unit price is far below the reference: confirm the specification and quality.' });
    } else checks.push({ name, status: 'pass', severity: 'high', detail: detailBase, weight: WEIGHTS.high, evidence: entry });
    price.push(entry);
  }
  return { price, checks, models, fixtures, fx };
}
