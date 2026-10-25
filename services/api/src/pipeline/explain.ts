/**
 * Plain-language explanation for the importer (PLAN 5.2 Explain, FLOWS I-3, I-4): the
 * fast model reads only the decision and the checks, never the documents, and names
 * exactly what to fix. The decision is already final when this runs.
 */
import { z } from 'zod';
import type { Check, Decision } from '@qafila/shared';
import type { AdapterContext } from '../adapters/base.js';
import type { LlmClient } from '../adapters/llm.js';
import { loadPrompt } from './prompts/index.js';
import type { ModelCall } from './types.js';

export const ExplanationSchema = z.object({
  summary: z.string().min(10),
  fixes: z.array(z.string()),
  category: z.string().nullable(),
});
const CATEGORIES = ['identity', 'sanctions', 'duplicate', 'prohibited_goods', 'document_integrity', 'shipment_mismatch'] as const;
export type ExplanationCategory = (typeof CATEGORIES)[number] | null;
export type Explanation = z.infer<typeof ExplanationSchema>;

/** Deterministic fallback so the importer always gets something readable. */
export function fallbackExplanation(decision: Decision, checks: Check[]): Explanation {
  const failed = checks.filter((c) => c.status === 'fail');
  const review = checks.filter((c) => c.status === 'review' || c.status === 'unavailable');
  const head = decision === 'approve' ? 'Your deal passed every check and is ready for listing.' : decision === 'reject' ? `Your deal was rejected: ${failed[0]?.detail ?? 'a critical check failed.'}` : `Your deal needs a review by our team: ${review[0]?.detail ?? 'a check needs a person.'}`;
  const fixes = [...failed, ...review].filter((c) => c.fix).map((c) => `${c.document ? `${c.document.replace('_', ' ')}: ` : ''}${c.fix}`);
  return { summary: head, fixes, category: decision === 'reject' ? categoryOf(failed) : null };
}

export function categoryOf(failed: Check[]): ExplanationCategory {
  const names = failed.map((c) => c.name);
  if (names.some((n) => n.startsWith('sanctions.'))) return 'sanctions';
  if (names.some((n) => n.startsWith('fingerprint.'))) return 'duplicate';
  if (names.some((n) => n.startsWith('halal.'))) return 'prohibited_goods';
  if (names.some((n) => n.startsWith('registry.') || n === 'validators.uscc_check_digit')) return 'identity';
  if (names.some((n) => n.startsWith('tracking.'))) return 'shipment_mismatch';
  return 'document_integrity';
}

export async function explain(decision: Decision, checks: Check[], llm: LlmClient, llmCtx: AdapterContext, cacheKey: string): Promise<{ explanation: Explanation; model: ModelCall | null; fixture: string | null }> {
  const prompt = loadPrompt('explain');
  const relevant = checks.filter((c) => c.status !== 'skipped' && c.weight > 0).map((c) => ({ name: c.name, status: c.status, detail: c.detail, document: c.document ?? null, field: c.field ?? null, fix: c.fix ?? null }));
  const res = await llm.structured({
    stage: 'explain',
    tier: 'fast',
    promptVersion: prompt.version,
    system: prompt.text,
    user: [{ text: `Decision: ${decision}\n\nChecks (JSON):\n${JSON.stringify(relevant, null, 1).slice(0, 30_000)}` }],
    schema: ExplanationSchema,
    toolName: 'record_explanation',
    toolDescription: 'Record the plain-language explanation for the importer.',
    cacheKey,
    maxTokens: 1500,
  }, llmCtx);
  const model: ModelCall = { stage: 'explain', provider: res.provider, model_id: res.modelId, prompt_version: res.promptVersion, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: res.latencyMs, cost_usd: res.costUsd };
  if (!res.ok || !res.data) return { explanation: fallbackExplanation(decision, checks), model, fixture: res.fixture };
  const e = res.data;
  const failed = checks.filter((c) => c.status === 'fail');
  const cat = (CATEGORIES as readonly string[]).includes(e.category ?? '') ? (e.category as ExplanationCategory) : null;
  return { explanation: { ...e, category: decision === 'reject' ? (cat ?? categoryOf(failed)) : null }, model, fixture: res.fixture };
}
