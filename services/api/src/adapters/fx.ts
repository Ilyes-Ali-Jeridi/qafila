/**
 * ECB rates fallback through frankfurter (PLAN 5.4). No NGN or KES there, so local
 * currency amounts are hidden when Reflector lacks them too.
 */
import { z } from 'zod';
import { defineAdapter } from './base.js';
import { fetchJson } from '../lib/retry.js';

export const FrankfurterSchema = z.object({ amount: z.number(), base: z.string(), date: z.string(), rates: z.record(z.string(), z.number()) });

export interface FxRate {
  from: string;
  to: string;
  rate: number; // 1 from = rate to
  date: string;
  source: 'ecb';
}

export function makeFx(baseUrl = 'https://api.frankfurter.dev/v1') {
  return defineAdapter<{ from: string; to: string }, z.infer<typeof FrankfurterSchema>, FxRate | null>({
    name: 'fx',
    keyOf: (i) => ({ from: i.from.toUpperCase(), to: i.to.toUpperCase(), day: new Date().toISOString().slice(0, 10) }),
    fixtureName: (i) => `${i.from.toUpperCase()}-${i.to.toUpperCase()}`,
    live: (i, signal) => fetchJson(`${baseUrl.replace(/\/$/, '')}/latest?base=${encodeURIComponent(i.from.toUpperCase())}&symbols=${encodeURIComponent(i.to.toUpperCase())}`, { signal }),
    schema: FrankfurterSchema,
    map: (raw, i) => {
      const rate = raw.rates[i.to.toUpperCase()];
      return rate === undefined ? null : { from: i.from.toUpperCase(), to: i.to.toUpperCase(), rate, date: raw.date, source: 'ecb' };
    },
  });
}
