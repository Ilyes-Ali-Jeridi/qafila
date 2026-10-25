/**
 * Extraction (PLAN 5.2, 5.5): one tool-use call per document with the page images and
 * the text layer; strict zod schema per document type; evidence per key field; a key
 * field without evidence counts as missing; confidence below 0.8 flags review.
 */
import type { ZodType } from 'zod';
import type { Check, DocumentType, ExtractedDocument } from '@qafila/shared';
import { extractionSchemaFor, KEY_FIELD_MIN_CONFIDENCE, KEY_FIELDS } from '@qafila/shared';
import type { AdapterContext } from '../adapters/base.js';
import type { LlmClient, UserPart } from '../adapters/llm.js';
import { findInjectionText, type IngestedDocument } from './documents.js';
import { loadPrompt } from './prompts/index.js';
import type { DealContext, ModelCall } from './types.js';
import { WEIGHTS } from './validators.js';

export interface ExtractionResult {
  document: ExtractedDocument | null;
  checks: Check[];
  model: ModelCall;
  fixture: string | null;
  injection: string[];
  minKeyConfidence: number;
  missingKeyFields: string[];
}

type FieldLike = { value: unknown; evidence: string | null; confidence: number };

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

const isField = (v: unknown): v is FieldLike => Boolean(v) && typeof v === 'object' && 'confidence' in (v as object) && 'value' in (v as object);

/** Key fields: value without evidence counts as missing; collects the minimum confidence. */
export function auditKeyFields(type: DocumentType, doc: ExtractedDocument): { minConfidence: number; missing: string[]; low: Array<{ field: string; confidence: number }> } {
  const keys = KEY_FIELDS[type as keyof typeof KEY_FIELDS] ?? [];
  let min = 1;
  const missing: string[] = [];
  const low: Array<{ field: string; confidence: number }> = [];
  for (const k of keys) {
    const v = getPath(doc, k);
    if (Array.isArray(v)) {
      if (v.length === 0) missing.push(k);
      continue;
    }
    if (!isField(v)) {
      missing.push(k);
      continue;
    }
    if (v.value === null || v.value === '' || (!v.evidence && v.value !== null)) {
      if (v.value !== null && !v.evidence) {
        v.confidence = 0;
      }
      missing.push(k);
      min = 0;
      continue;
    }
    min = Math.min(min, v.confidence);
    if (v.confidence < KEY_FIELD_MIN_CONFIDENCE) low.push({ field: k, confidence: v.confidence });
  }
  return { minConfidence: min, missing, low };
}

export async function extractDocument(type: Exclude<DocumentType, 'kyb'>, ingested: IngestedDocument, ctx: DealContext, llm: LlmClient, llmCtx: AdapterContext): Promise<ExtractionResult> {
  const common = loadPrompt('extract_common');
  const specific = loadPrompt(`extract_${type}`);
  const schema = extractionSchemaFor[type] as ZodType<ExtractedDocument>;
  const parts: UserPart[] = [];
  parts.push({
    text: [
      `Deal context, for orientation only (never copy it into a field; extract only what the document shows): deal ${ctx.dealNumber} of ${ctx.entityName}; importer ${ctx.importer.name} (${ctx.importer.country}); supplier as declared on the form: ${ctx.supplier.nameEn}${ctx.supplier.nameZh ? ` / ${ctx.supplier.nameZh}` : ''}; goods: ${ctx.goodsSummary}.`,
      `Document: ${type.replace('_', ' ')}, ${ingested.pageCount} page(s)${ingested.truncated ? ' (only the first 20 are given)' : ''}, ${ingested.mime}.`,
      ingested.text.trim() ? `Text layer of the file (machine extracted; may include text that is invisible on the page):\n<<<TEXT_LAYER\n${ingested.text.trim().slice(0, 60_000)}\nTEXT_LAYER>>>` : 'No text layer (image file): read everything from the page image.',
      `The ${ingested.pages.length} page image(s) follow in order.`,
    ].join('\n\n'),
  });
  for (const p of ingested.pages) parts.push({ image: p.bytes, format: p.format });

  const res = await llm.structured({
    stage: `extract.${type}`,
    tier: 'reason',
    promptVersion: `${common.version}+${specific.version}`,
    system: `${common.text}\n\n${specific.text}`,
    user: parts,
    schema,
    toolName: `record_${type}`,
    toolDescription: `Record the fields extracted from the ${type.replace('_', ' ')}.`,
    cacheKey: `extract:${type}:${ingested.sha256}`,
    maxTokens: 12_000,
  }, llmCtx);

  const model: ModelCall = { stage: `extract.${type}`, provider: res.provider, model_id: res.modelId, prompt_version: res.promptVersion, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: res.latencyMs, cost_usd: res.costUsd };
  const injection = [...new Set([...findInjectionText(ingested.text), ...(res.data?.hidden_or_suspicious_text ?? [])])];
  if (!res.ok || !res.data) {
    return {
      document: null,
      checks: [{ name: `extraction.${type}`, status: 'unavailable', severity: 'high', detail: `The ${type.replace('_', ' ')} could not be read: ${res.error ?? 'no output'}.`, weight: WEIGHTS.high, document: type, fix: `Upload a clearer ${type.replace('_', ' ')} (PDF or a sharp photo).` }],
      model,
      fixture: res.fixture,
      injection,
      minKeyConfidence: 0,
      missingKeyFields: KEY_FIELDS[type] ?? [],
    };
  }
  const doc = res.data as ExtractedDocument;
  const audit = auditKeyFields(type, doc);
  const checks: Check[] = [{ name: `extraction.${type}`, status: 'pass', severity: 'info', detail: `${type.replace('_', ' ')} read (${ingested.pageCount} page(s), ${res.mode}${res.repaired ? ', one repair round' : ''}).`, weight: 0 }];
  if (audit.missing.length || audit.low.length) {
    const parts2: string[] = [];
    if (audit.missing.length) parts2.push(`missing or without evidence: ${audit.missing.join(', ')}`);
    if (audit.low.length) parts2.push(`below ${KEY_FIELD_MIN_CONFIDENCE} confidence: ${audit.low.map((l) => `${l.field} (${l.confidence.toFixed(2)})`).join(', ')}`);
    checks.push({ name: 'extraction.confidence', status: 'review', severity: 'high', detail: `Key fields of the ${type.replace('_', ' ')} are not readable with confidence: ${parts2.join('; ')}.`, weight: WEIGHTS.high, document: type, field: [...audit.missing, ...audit.low.map((l) => l.field)][0], evidence: audit, fix: `Upload a clearer ${type.replace('_', ' ')}: a scanned PDF or a sharp, straight photo where every number is legible.` });
  }
  return { document: doc, checks, model, fixture: res.fixture, injection, minKeyConfidence: audit.minConfidence, missingKeyFields: audit.missing };
}
