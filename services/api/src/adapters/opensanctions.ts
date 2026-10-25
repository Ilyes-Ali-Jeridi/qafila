/**
 * OpenSanctions match API (PLAN 5.4): POST /match/default with Company, Person and Vessel
 * queries; `Authorization: ApiKey <key>`. Thresholds live in the decision policy (5.6):
 * score >= 0.9 reject, 0.7 to 0.9 review. Mock mode replays data/fixtures/opensanctions/
 * <slug>.json and answers "no match" from the recorded empty response otherwise.
 */
import { z } from 'zod';
import { defineAdapter } from './base.js';
import { fetchJson } from '../lib/retry.js';

export const MatchResultSchema = z.object({
  id: z.string(),
  caption: z.string(),
  schema: z.string(),
  datasets: z.array(z.string()).default([]),
  score: z.number(),
  match: z.boolean().optional().default(false),
  features: z.record(z.string(), z.number()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const MatchResponseSchema = z.object({
  responses: z.record(
    z.string(),
    z.object({
      status: z.number().optional(),
      results: z.array(MatchResultSchema),
      total: z.object({ value: z.number(), relation: z.string().optional() }).optional(),
    }),
  ),
});
export type MatchResponse = z.infer<typeof MatchResponseSchema>;

export interface SanctionsQuery {
  id: string;
  schema: 'Company' | 'Person' | 'Vessel';
  name: string;
  country?: string;
  imoNumber?: string;
  registrationNumber?: string;
}

export interface SanctionsHit {
  party: string;
  schema: 'Company' | 'Person' | 'Vessel';
  score: number;
  matchId: string | null;
  matchName: string | null;
  datasets: string[];
}

export const slug = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9㐀-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function mapMatches(raw: MatchResponse, queries: SanctionsQuery[]): SanctionsHit[] {
  return queries.map((q) => {
    const r = raw.responses[q.id];
    const top = r?.results.slice().sort((a, b) => b.score - a.score)[0];
    return { party: q.id, schema: q.schema, score: top?.score ?? 0, matchId: top?.id ?? null, matchName: top?.caption ?? null, datasets: top?.datasets ?? [] };
  });
}

export function makeOpenSanctions(cfg: { apiKey?: string; baseUrl?: string }) {
  const base = (cfg.baseUrl ?? 'https://api.opensanctions.org').replace(/\/$/, '');
  return defineAdapter<{ queries: SanctionsQuery[] }, MatchResponse, SanctionsHit[]>({
    name: 'opensanctions',
    keyOf: (i) => ({ queries: i.queries.map((q) => ({ id: q.id, schema: q.schema, name: q.name.trim().toLowerCase(), country: q.country, imo: q.imoNumber })) }),
    fixtureName: (i) => i.queries.map((q) => slug(q.name)).join('__').slice(0, 120),
    live: (i, signal) => {
      if (!cfg.apiKey) throw new Error('OPENSANCTIONS_API_KEY missing');
      const queries = Object.fromEntries(
        i.queries.map((q) => [
          q.id,
          {
            schema: q.schema,
            properties: {
              name: [q.name],
              ...(q.country ? { country: [q.country] } : {}),
              ...(q.imoNumber ? { imoNumber: [q.imoNumber] } : {}),
              ...(q.registrationNumber ? { registrationNumber: [q.registrationNumber] } : {}),
            },
          },
        ]),
      );
      return fetchJson(`${base}/match/default?algorithm=logic-v1&threshold=0.7&cutoff=0.5&limit=5`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `ApiKey ${cfg.apiKey}` },
        body: JSON.stringify({ queries }),
        signal,
      });
    },
    schema: MatchResponseSchema,
    map: (raw, i) => mapMatches(raw, i.queries),
    costOf: (raw) => Object.keys(raw.responses).length * 0.0025,
    mockFallback: (i) => ({ responses: Object.fromEntries(i.queries.map((q) => [q.id, { status: 200, results: [], total: { value: 0, relation: 'eq' } }])) }),
  });
}
