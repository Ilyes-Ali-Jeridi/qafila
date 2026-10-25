/**
 * Sanctions screening (PLAN 5.2): supplier, importer, legal representative when the
 * registry gives one, and the vessel by IMO at the shipment stage, through the
 * OpenSanctions match API. Thresholds from the policy: >= 0.9 reject, 0.7 to 0.9 review.
 */
import type { z } from 'zod';
import type { Check, SanctionsHitSchema } from '@qafila/shared';
import type { Adapters } from '../adapters/index.js';
import type { SanctionsQuery } from '../adapters/opensanctions.js';
import type { HalalPolicy } from './types.js';
import { WEIGHTS } from './validators.js';

export type SanctionsHit = z.infer<typeof SanctionsHitSchema>;

export interface SanctionsStageResult {
  sanctions: SanctionsHit[];
  checks: Check[];
  fixtures: string[];
  maxScore: number;
  available: boolean;
}

export async function sanctionsStage(parties: { supplier: { name: string; nameZh?: string | null; country?: string }; importer: { name: string; country: string }; legalRepresentative?: string | null; vessel?: { name: string; imo?: string | null } | null }, policy: HalalPolicy, adapters: Adapters): Promise<SanctionsStageResult> {
  const queries: SanctionsQuery[] = [
    { id: 'supplier', schema: 'Company', name: parties.supplier.name, country: parties.supplier.country ?? 'cn' },
    { id: 'importer', schema: 'Company', name: parties.importer.name, country: parties.importer.country.toLowerCase() },
  ];
  if (parties.legalRepresentative) queries.push({ id: 'legal_representative', schema: 'Person', name: parties.legalRepresentative, country: 'cn' });
  if (parties.vessel?.name) queries.push({ id: 'vessel', schema: 'Vessel', name: parties.vessel.name, imoNumber: parties.vessel.imo ?? undefined });
  const r = await adapters.opensanctions({ queries }, adapters.ctx.opensanctions);
  const fixtures = r.fixture ? [r.fixture] : [];
  if (r.status !== 'ok' || !r.data) {
    return { sanctions: [], checks: [{ name: 'sanctions.screen', status: 'unavailable', severity: 'critical', detail: `Sanctions screening could not run (${r.error ?? 'unknown'}).`, weight: WEIGHTS.critical }], fixtures, maxScore: 0, available: false };
  }
  const label = r.mode === 'mock' ? 'OpenSanctions (mock fixture)' : 'OpenSanctions';
  const checks: Check[] = [];
  const hits: SanctionsHit[] = r.data.map((h) => ({ party: h.party, schema: h.schema, score: h.score, match_id: h.matchId, match_name: h.matchName, datasets: h.datasets, topics: h.topics ?? [] }));
  // Topics that mean a listed party (sanctions, debarment, crime, export controls). A match with known topics outside this set
  // (politically exposed person, person of interest, a common name on a parliament roster) is a review, never a reject.
  const LISTED = /^(sanction|debarment|crime|export\.control|wanted|reg\.warn)/;
  for (const h of hits) {
    const q = queries.find((x) => x.id === h.party)!;
    const name = `sanctions.${h.party}`;
    const listed = h.topics.length === 0 || h.topics.some((t) => LISTED.test(t));
    if (!listed && h.score >= policy.thresholds.sanctionsReview) {
      checks.push({ name, status: 'review', severity: 'high', detail: `${label}: ${q.schema.toLowerCase()} "${q.name}" matches "${h.match_name}" at ${h.score.toFixed(2)} on a non-sanctions list (${h.topics.join(', ')}); a person checks whether it is the same party.`, weight: WEIGHTS.high, evidence: h, fix: 'Confirm identity (date of birth, address) or document why it is a different party.' });
      continue;
    }
    if (h.score >= policy.thresholds.sanctionsReject) checks.push({ name, status: 'fail', severity: 'critical', detail: `${label}: ${q.schema.toLowerCase()} "${q.name}" matches "${h.match_name}" at ${h.score.toFixed(2)} (${h.datasets.join(', ') || 'no dataset'}).`, weight: WEIGHTS.critical, evidence: h, fix: 'A sanctioned party cannot take part in a deal. The account goes under review.' });
    else if (h.score >= policy.thresholds.sanctionsReview) checks.push({ name, status: 'review', severity: 'high', detail: `${label}: ${q.schema.toLowerCase()} "${q.name}" is a possible match for "${h.match_name}" at ${h.score.toFixed(2)}.`, weight: WEIGHTS.high, evidence: h, fix: 'Ops reviews the possible match.' });
    else checks.push({ name, status: 'pass', severity: 'critical', detail: `${label}: no sanctions match for ${q.schema.toLowerCase()} "${q.name}"${h.score > 0 ? ` (best score ${h.score.toFixed(2)})` : ''}.`, weight: WEIGHTS.critical, evidence: h });
  }
  // The policy thresholds (PLAN 5.6) apply to listed parties only; a PEP or person-of-interest match never counts as a sanctions score.
  const listedScores = hits.filter((h) => h.topics.length === 0 || h.topics.some((t) => LISTED.test(t))).map((h) => h.score);
  return { sanctions: hits, checks, fixtures, maxScore: Math.max(0, ...listedScores), available: true };
}
