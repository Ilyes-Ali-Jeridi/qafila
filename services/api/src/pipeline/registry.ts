/**
 * Supplier registry chain (PLAN 5.2, Prompt B item 1): USCC check digit first, then QCC
 * when configured, then GLEIF (live, free), then the fixture in mock mode. Chinese name:
 * exact match after normalising full-width characters and brackets. English name: LLM
 * judge with evidence. Decision inputs: INACTIVE, revoked or deregistered reject; not
 * found, LEI lapsed or name mismatch review (with a gsxt.gov.cn link for ops); found,
 * ACTIVE, ISSUED and name match pass. An ops override after a manual check counts as
 * passed for the agent (audit-logged).
 */
import { z } from 'zod';
import type { BusinessLicence, Check, RegistryResultSchema } from '@qafila/shared';
import { readFixture } from '../adapters/base.js';
import type { RegistryLookup } from '../adapters/gleif.js';
import type { Adapters } from '../adapters/index.js';
import { coreEnName, normaliseZhName } from './normalise.js';
import { loadPrompt } from './prompts/index.js';
import type { DealContext, ModelCall } from './types.js';
import { isValidUscc, WEIGHTS } from './validators.js';

export type RegistryResult = z.infer<typeof RegistryResultSchema>;

export const GSXT_URL = 'https://www.gsxt.gov.cn/';

export interface RegistryStageResult {
  registry: RegistryResult;
  lookup: RegistryLookup | null;
  checks: Check[];
  models: ModelCall[];
  fixtures: string[];
  facts: { available: boolean; found: boolean; entityStatus: string | null; leiStatus: string | null; nameMatch: 'yes' | 'no' | 'unsure' | 'n/a'; usccValid: boolean | null };
}

const INACTIVE = /^(INACTIVE|CLOSED|REVOKED|DEREGISTERED|CANCELLED|DISSOLVED|吊销|注销|撤销)$/i;

const NameJudge = z.object({ match: z.enum(['yes', 'no', 'unsure']), reason: z.string(), evidence_a: z.string(), evidence_b: z.string() });

export async function registryStage(lic: BusinessLicence | null, ctx: DealContext, adapters: Adapters): Promise<RegistryStageResult> {
  const uscc = (lic?.uscc.value ?? ctx.supplier.uscc ?? '').toUpperCase().trim() || null;
  const nameZh = lic?.name_zh.value ?? ctx.supplier.nameZh ?? null;
  const nameEn = lic?.name_en.value ?? ctx.supplier.nameEn;
  const checks: Check[] = [];
  const models: ModelCall[] = [];
  const fixtures: string[] = [];
  const empty: RegistryResult = { source: 'none', mode: 'unavailable', found: false, lei: null, legal_name_zh: null, legal_name_en: null, entity_status: null, lei_status: null, country: null, name_match_zh: 'n/a', name_match_en: 'n/a', manual_check_url: GSXT_URL };

  const usccValid = uscc ? isValidUscc(uscc) : null;
  if (!uscc || !usccValid) {
    checks.push({ name: 'registry.lookup', status: 'skipped', severity: 'high', detail: uscc ? 'Registry lookup skipped: the company code fails its check character.' : 'Registry lookup skipped: no company code.', weight: 0, document: 'business_licence', field: 'uscc' });
    return { registry: { ...empty, mode: 'skipped' }, lookup: null, checks, models, fixtures, facts: { available: false, found: false, entityStatus: null, leiStatus: null, nameMatch: 'n/a', usccValid } };
  }

  const regCtx = adapters.ctx.registry;
  let lookup: RegistryLookup | null = null;
  let source: RegistryResult['source'] = 'none';
  let mode: RegistryResult['mode'] = 'unavailable';
  let unavailableReason: string | null = null;

  if (regCtx.mode === 'mock') {
    const fx = readFixture(regCtx, 'registry', uscc);
    if (fx) {
      lookup = fx.raw as RegistryLookup;
      source = 'fixture';
      mode = 'mock';
      fixtures.push(fx.file);
    } else {
      // No fixture for this supplier: in mock mode GLEIF recordings may still exist.
      const g = await adapters.gleif({ uscc }, regCtx);
      if (g.status === 'ok' && g.data) {
        lookup = g.data;
        source = 'gleif';
        mode = 'mock';
        if (g.fixture) fixtures.push(g.fixture);
      } else unavailableReason = `no registry fixture for ${uscc}`;
    }
  } else {
    if (adapters.qcc) {
      const q = await adapters.qcc({ uscc }, regCtx);
      if (q.status === 'ok' && q.data?.found) {
        lookup = q.data;
        source = 'qcc';
        mode = 'live';
      } else if (q.status !== 'ok') unavailableReason = q.error;
    }
    if (!lookup) {
      const g = await adapters.gleif({ uscc }, regCtx);
      if (g.status === 'ok' && g.data) {
        lookup = g.data;
        source = 'gleif';
        mode = 'live';
        unavailableReason = null;
      } else if (g.status !== 'ok') unavailableReason = g.error ?? unavailableReason;
    }
    if (!lookup) {
      // Not in the live registry: the fictional demo suppliers have recorded fixtures, used here and labelled mock in the report.
      const fx = readFixture(regCtx, 'registry', uscc);
      if (fx) {
        lookup = fx.raw as RegistryLookup;
        source = 'fixture';
        mode = 'mock';
        fixtures.push(fx.file);
        unavailableReason = null;
      }
    }
  }

  if (!lookup) {
    checks.push({ name: 'registry.lookup', status: 'unavailable', severity: 'high', detail: `The company registry could not be reached (${unavailableReason ?? 'unknown'}). Manual check: ${GSXT_URL}`, weight: WEIGHTS.high, document: 'business_licence', field: 'uscc' });
    return { registry: { ...empty, mode: 'unavailable' }, lookup: null, checks, models, fixtures, facts: { available: false, found: false, entityStatus: null, leiStatus: null, nameMatch: 'n/a', usccValid } };
  }

  const registry: RegistryResult = {
    source,
    mode,
    found: lookup.found,
    lei: lookup.lei,
    legal_name_zh: lookup.legalNameZh,
    legal_name_en: lookup.legalNameEn,
    entity_status: lookup.entityStatus,
    lei_status: lookup.leiStatus,
    country: lookup.country,
    name_match_zh: 'n/a',
    name_match_en: 'n/a',
    manual_check_url: GSXT_URL,
  };
  const label = source === 'fixture' ? 'registry fixture (mock)' : source === 'gleif' ? `GLEIF${mode === 'mock' ? ' recording (mock)' : ''}` : 'QCC';

  if (!lookup.found) {
    checks.push({ name: 'registry.status', status: 'review', severity: 'high', detail: `Company ${uscc} was not found in ${label}. GLEIF only covers companies with an LEI, so a person must check ${GSXT_URL}.`, weight: WEIGHTS.high, document: 'business_licence', field: 'uscc', evidence: { source, uscc }, fix: 'Ops checks the licence on gsxt.gov.cn and overrides the registry check if it is genuine.' });
    return { registry, lookup, checks, models, fixtures, facts: { available: true, found: false, entityStatus: null, leiStatus: null, nameMatch: 'n/a', usccValid } };
  }

  // Names
  let nameMatch: 'yes' | 'no' | 'unsure' | 'n/a' = 'n/a';
  if (nameZh && lookup.legalNameZh) {
    registry.name_match_zh = normaliseZhName(nameZh) === normaliseZhName(lookup.legalNameZh) ? 'yes' : 'no';
    nameMatch = registry.name_match_zh;
  }
  if (nameMatch !== 'yes' && lookup.legalNameEn && nameEn) {
    if (coreEnName(nameEn) === coreEnName(lookup.legalNameEn)) registry.name_match_en = 'yes';
    else {
      const prompt = loadPrompt('name_match');
      const res = await adapters.llm.structured({
        stage: 'registry.name_match',
        tier: 'fast',
        promptVersion: prompt.version,
        system: prompt.text,
        user: [{ text: `Entity kind: company\nName A (business licence / deal form): ${nameEn}\nName B (registry ${label}): ${lookup.legalNameEn}` }],
        schema: NameJudge,
        toolName: 'record_name_match',
        toolDescription: 'Record whether the two names are the same company.',
        maxTokens: 400,
      }, adapters.ctx.llm);
      models.push({ stage: 'registry.name_match', provider: res.provider, model_id: res.modelId, prompt_version: res.promptVersion, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: res.latencyMs, cost_usd: res.costUsd });
      if (res.fixture) fixtures.push(res.fixture);
      registry.name_match_en = res.ok && res.data ? res.data.match : 'unsure';
    }
    if (nameMatch !== 'no') nameMatch = registry.name_match_en;
  }
  if (nameMatch === 'n/a' && (nameZh || nameEn)) nameMatch = 'unsure';

  const status = (lookup.entityStatus ?? '').toUpperCase();
  const lei = (lookup.leiStatus ?? '').toUpperCase();
  const facts = { available: true, found: true, entityStatus: lookup.entityStatus, leiStatus: lookup.leiStatus, nameMatch, usccValid };
  const evidence = { source, uscc, legal_name_zh: lookup.legalNameZh, legal_name_en: lookup.legalNameEn, entity_status: lookup.entityStatus, lei_status: lookup.leiStatus, name_match_zh: registry.name_match_zh, name_match_en: registry.name_match_en };

  if (INACTIVE.test(status)) {
    checks.push({ name: 'registry.status', status: 'fail', severity: 'critical', detail: `${label}: company ${uscc} (${lookup.legalNameZh ?? lookup.legalNameEn ?? ''}) is ${status}${lei ? `, LEI ${lei}` : ''}. A closed or deregistered company cannot supply the goods.`, weight: WEIGHTS.critical, evidence, document: 'business_licence', field: 'uscc', fix: 'The supplier is not an active company; the deal cannot proceed with this supplier.' });
  } else if (status !== 'ACTIVE') {
    checks.push({ name: 'registry.status', status: 'review', severity: 'high', detail: `${label}: company ${uscc} has status "${lookup.entityStatus ?? 'unknown'}". Manual check: ${GSXT_URL}`, weight: WEIGHTS.high, evidence, document: 'business_licence', field: 'uscc', fix: 'Ops confirms the status on gsxt.gov.cn.' });
  } else if (lei && lei !== 'ISSUED' && source === 'gleif') {
    checks.push({ name: 'registry.status', status: 'review', severity: 'medium', detail: `${label}: company ${uscc} is ACTIVE but its LEI is ${lei} (renewal lapsed). Manual check: ${GSXT_URL}`, weight: WEIGHTS.medium, evidence, document: 'business_licence', field: 'uscc', fix: 'Ops confirms the company on gsxt.gov.cn; a lapsed LEI alone is not a rejection.' });
  } else {
    checks.push({ name: 'registry.status', status: 'pass', severity: 'critical', detail: `${label}: company ${uscc} (${lookup.legalNameZh ?? ''}${lookup.legalNameEn ? ` / ${lookup.legalNameEn}` : ''}) is ACTIVE${lei ? `, LEI ${lei}` : ''}.`, weight: WEIGHTS.critical, evidence });
  }

  if (nameMatch === 'yes') checks.push({ name: 'registry.name_match', status: 'pass', severity: 'high', detail: `The licence name matches the registry record (${registry.name_match_zh === 'yes' ? 'Chinese name exact' : 'English name judged equal'}).`, weight: WEIGHTS.high, evidence });
  else if (nameMatch === 'no') checks.push({ name: 'registry.name_match', status: 'review', severity: 'high', detail: `The licence name (${nameZh ?? nameEn}) does not match the registry record (${lookup.legalNameZh ?? lookup.legalNameEn}). Manual check: ${GSXT_URL}`, weight: WEIGHTS.high, evidence, document: 'business_licence', field: 'name_zh', fix: 'The licence must be the one of the company registered under this code.' });
  else if (nameMatch === 'unsure') checks.push({ name: 'registry.name_match', status: 'review', severity: 'medium', detail: `The licence name could not be matched to the registry record with confidence. Manual check: ${GSXT_URL}`, weight: WEIGHTS.medium, evidence, document: 'business_licence', field: 'name_zh', fix: 'Ops compares the names on gsxt.gov.cn.' });

  if (ctx.registryOverride) {
    checks.push({ name: 'registry.override', status: 'pass', severity: 'info', detail: 'Ops overrode the registry check after a manual gsxt.gov.cn lookup (audit log).', weight: 0 });
  }
  return { registry, lookup, checks, models, fixtures, facts };
}
