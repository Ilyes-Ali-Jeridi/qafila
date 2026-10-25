/**
 * Halal screen (PLAN 5.2): the fast model classifies each line item into a category of
 * the policy table stored in the database (editable by the Sharia role); the verdict
 * comes from the table, never from the model. Prohibited rejects, review reviews.
 */
import { z } from 'zod';
import type { Check, Invoice } from '@qafila/shared';
import type { AdapterContext } from '../adapters/base.js';
import type { LlmClient } from '../adapters/llm.js';
import { loadPrompt } from './prompts/index.js';
import type { HalalLine, HalalPolicy, ModelCall } from './types.js';
import { WEIGHTS } from './validators.js';

export const DEFAULT_HALAL_POLICY: HalalPolicy = {
  version: 1,
  categories: [
    { id: 'alcohol', label: 'Alcoholic drinks and products containing alcohol', verdict: 'prohibited', description: 'Wine, beer, spirits, liqueurs, alcohol-based flavourings' },
    { id: 'pork', label: 'Pork and pork by-products', verdict: 'prohibited', description: 'Pork meat, lard, gelatine from pork, pork-based casings' },
    { id: 'non_halal_meat', label: 'Meat and poultry without halal certification', verdict: 'review', description: 'Meat products whose slaughter certification is not shown' },
    { id: 'gambling', label: 'Gambling equipment', verdict: 'prohibited', description: 'Slot machines, casino tables, lottery terminals, betting devices' },
    { id: 'weapons', label: 'Weapons and ammunition', verdict: 'prohibited', description: 'Firearms, ammunition, military equipment' },
    { id: 'adult', label: 'Adult material', verdict: 'prohibited', description: 'Pornographic material and adult toys' },
    { id: 'tobacco', label: 'Tobacco, vaping and nicotine products', verdict: 'review', description: 'Cigarettes, e-cigarettes, shisha tobacco' },
    { id: 'interest_products', label: 'Interest-bearing financial products', verdict: 'prohibited', description: 'Bonds, interest-based instruments, debt sold at a discount' },
    { id: 'idols', label: 'Statues and objects for worship', verdict: 'review', description: 'Religious idols and objects made for worship' },
    { id: 'music_instruments', label: 'Musical instruments and entertainment equipment', verdict: 'review', description: 'Instruments, DJ equipment; scholars differ' },
    { id: 'cosmetics', label: 'Cosmetics and personal care', verdict: 'permitted', description: 'Lotions, soaps, hair products without alcohol or pork derivatives' },
    { id: 'pharma', label: 'Medicines and supplements', verdict: 'review', description: 'Ingredients and certification need a look' },
    { id: 'food_halal', label: 'Food and drink without alcohol or pork', verdict: 'permitted', description: 'Rice, oils, spices, beverages without alcohol' },
    { id: 'electronics', label: 'Electronics and phone accessories', verdict: 'permitted', description: 'Phones, accessories, cables, chargers, power banks, lighting' },
    { id: 'textiles', label: 'Textiles, clothing and footwear', verdict: 'permitted', description: 'Fabrics, garments, shoes, bags' },
    { id: 'machinery', label: 'Machinery, tools, vehicles and parts', verdict: 'permitted', description: 'Generators, pumps, motorcycle and car parts, tyres, sewing machines' },
    { id: 'building_materials', label: 'Building materials and hardware', verdict: 'permitted', description: 'Tiles, pipes, roofing, cement, fittings' },
    { id: 'household', label: 'Household goods and kitchenware', verdict: 'permitted', description: 'Cookware, plastics, appliances, furniture' },
    { id: 'energy', label: 'Solar and energy equipment', verdict: 'permitted', description: 'Solar panels, inverters, batteries' },
    { id: 'agriculture', label: 'Agricultural inputs and equipment', verdict: 'permitted', description: 'Seeds, fertiliser, tools, irrigation' },
    { id: 'unclassified', label: 'Nothing in the policy fits', verdict: 'review', description: 'A person decides' },
  ],
  thresholds: { priceRatioLow: 0.5, priceRatioHigh: 2, sanctionsReview: 0.7, sanctionsReject: 0.9, weightReviewPct: 2, weightRejectPct: 5, keyFieldMinConfidence: 0.8 },
};

export interface HalalResult {
  lines: HalalLine[];
  checks: Check[];
  models: ModelCall[];
  fixtures: string[];
}

export async function halalScreen(inv: Invoice | null, policy: HalalPolicy, llm: LlmClient, llmCtx: AdapterContext): Promise<HalalResult> {
  if (!inv || inv.line_items.length === 0) {
    return { lines: [], checks: [{ name: 'halal.screen', status: 'unavailable', severity: 'critical', detail: 'No invoice line items to screen.', weight: WEIGHTS.critical, document: 'invoice', field: 'line_items', fix: 'The invoice must list the goods.' }], models: [], fixtures: [] };
  }
  const ids = policy.categories.map((c) => c.id) as [string, ...string[]];
  const Output = z.object({ lines: z.array(z.object({ line_index: z.number().int(), category: z.enum(ids), reason: z.string() })).min(1) });
  const prompt = loadPrompt('halal');
  const table = policy.categories.map((c) => `- ${c.id}: ${c.label}. ${c.description}`).join('\n');
  const items = inv.line_items.map((l, i) => `line_index ${i + 1}: ${l.description_en.value ?? ''}${l.description_zh.value ? ` / ${l.description_zh.value}` : ''}${l.hs_code.value ? ` (HS ${l.hs_code.value})` : ''}`).join('\n');
  const res = await llm.structured({
    stage: 'halal',
    tier: 'fast',
    promptVersion: `${prompt.version}+policy.v${policy.version}`,
    system: `${prompt.text}\n\nCategories:\n${table}`,
    user: [{ text: `Line items:\n${items}` }],
    schema: Output,
    toolName: 'record_categories',
    toolDescription: 'Record the policy category of every line item.',
    maxTokens: 2500,
  }, llmCtx);
  const models: ModelCall[] = [{ stage: 'halal', provider: res.provider, model_id: res.modelId, prompt_version: res.promptVersion, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: res.latencyMs, cost_usd: res.costUsd }];
  const fixtures = res.fixture ? [res.fixture] : [];
  if (!res.ok || !res.data) {
    return { lines: [], checks: [{ name: 'halal.screen', status: 'unavailable', severity: 'critical', detail: `The halal screen did not run: ${res.error ?? 'no answer'}.`, weight: WEIGHTS.critical, document: 'invoice', field: 'line_items' }], models, fixtures };
  }
  const lines: HalalLine[] = [];
  const checks: Check[] = [];
  for (const [i, l] of inv.line_items.entries()) {
    const cls = res.data.lines.find((x) => x.line_index === i + 1) ?? res.data.lines[i];
    const cat = policy.categories.find((c) => c.id === cls?.category) ?? policy.categories.find((c) => c.id === 'unclassified')!;
    const desc = l.description_en.value ?? l.description_zh.value ?? `line ${i + 1}`;
    const line: HalalLine = { line: `${i + 1}. ${desc}`, category: cat.id, verdict: cat.verdict, reason: cls?.reason ?? 'Not classified; policy default is review.' };
    lines.push(line);
    const name = `halal.line_${i + 1}`;
    if (cat.verdict === 'permitted') checks.push({ name, status: 'pass', severity: 'critical', detail: `Line ${i + 1} (${desc}) is ${cat.label.toLowerCase()}: permitted.`, weight: WEIGHTS.critical, evidence: line });
    else if (cat.verdict === 'prohibited') checks.push({ name, status: 'fail', severity: 'critical', detail: `Line ${i + 1} (${desc}) is ${cat.label.toLowerCase()}: prohibited by the halal policy.`, weight: WEIGHTS.critical, evidence: line, document: 'invoice', field: `line_items[${i}]`, fix: 'Remove this line from the deal; Qafila cannot finance it.' });
    else checks.push({ name, status: 'review', severity: 'high', detail: `Line ${i + 1} (${desc}) is ${cat.label.toLowerCase()}: the policy asks for a review.`, weight: WEIGHTS.high, evidence: line, document: 'invoice', field: `line_items[${i}]`, fix: 'Provide certification or details for this line, or remove it.' });
  }
  return { lines, checks, models, fixtures };
}
