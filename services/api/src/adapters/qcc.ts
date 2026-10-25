/**
 * QCC international CN eKYB (PLAN 5.4): mainland business-licence check, used only when
 * QCC_API_KEY is set; no key means the registry chain skips it silently.
 *
 * Auth per developer.qcckyc.com: headers `ApiKey`, `Timespan` (unix seconds) and
 * `Token` = MD5(ApiKey + Timespan + SecretKey) upper-case. The exact endpoint path and
 * response field names could not be fetched during the event (the portal needs a login),
 * so both are configurable (QCC_BASE_URL, QCC_EKYB_PATH) and the response schema is
 * lenient. UNVERIFIED LIVE: see docs/SPIKES-intel.md.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { defineAdapter } from './base.js';
import { fetchJson } from '../lib/retry.js';
import type { RegistryLookup } from './gleif.js';

export interface QccConfig {
  apiKey: string;
  secretKey?: string;
  baseUrl: string;
  ekybPath: string;
}

const QccResultSchema = z.object({
  Status: z.union([z.string(), z.number()]).optional(),
  Message: z.string().optional(),
  Result: z
    .object({
      Name: z.string().nullable().optional(),
      EnglishName: z.string().nullable().optional(),
      CreditCode: z.string().nullable().optional(),
      Status: z.string().nullable().optional(),
      OperName: z.string().nullable().optional(),
      RegistCapi: z.string().nullable().optional(),
      Scope: z.string().nullable().optional(),
      StartDate: z.string().nullable().optional(),
      Address: z.string().nullable().optional(),
      UpdatedDate: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type QccResult = z.infer<typeof QccResultSchema>;

/** QCC status strings are Chinese ("存续", "在业", "吊销", "注销", "迁出", "撤销", "清算"). */
export function normaliseQccStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/存续|在业|开业|正常/.test(s)) return 'ACTIVE';
  if (/吊销|注销|撤销|清算|停业|迁出|歇业/.test(s)) return 'INACTIVE';
  return s;
}

export function mapQcc(raw: QccResult, uscc: string): RegistryLookup {
  const r = raw.Result;
  const code = String(raw.Status ?? '');
  if (!r || (code && code !== '200' && code !== '0')) {
    return { found: false, lei: null, legalNameZh: null, legalNameEn: null, entityStatus: null, leiStatus: null, registeredAt: null, lastUpdate: null, address: null, country: 'CN', legalRepresentative: null, businessScope: null, registeredAs: uscc };
  }
  return {
    found: true,
    lei: null,
    legalNameZh: r.Name ?? null,
    legalNameEn: r.EnglishName ?? null,
    entityStatus: normaliseQccStatus(r.Status),
    leiStatus: null,
    registeredAt: r.StartDate ?? null,
    lastUpdate: r.UpdatedDate ?? null,
    address: r.Address ?? null,
    country: 'CN',
    legalRepresentative: r.OperName ?? null,
    businessScope: r.Scope ?? null,
    registeredAs: r.CreditCode ?? uscc,
  };
}

export function qccHeaders(cfg: QccConfig, now = Math.floor(Date.now() / 1000)): Record<string, string> {
  const timespan = String(now);
  const token = createHash('md5').update(`${cfg.apiKey}${timespan}${cfg.secretKey ?? ''}`).digest('hex').toUpperCase();
  return { ApiKey: cfg.apiKey, Timespan: timespan, Token: token, accept: 'application/json' };
}

export function makeQccLookup(cfg: QccConfig) {
  return defineAdapter<{ uscc: string }, QccResult, RegistryLookup>({
    name: 'qcc',
    keyOf: (i) => ({ uscc: i.uscc.toUpperCase() }),
    fixtureName: (i) => i.uscc.toUpperCase(),
    live: (i, signal) => fetchJson(`${cfg.baseUrl}${cfg.ekybPath}?creditCode=${encodeURIComponent(i.uscc.toUpperCase())}`, { headers: qccHeaders(cfg), signal }),
    schema: QccResultSchema,
    map: (raw, i) => mapQcc(raw, i.uscc),
    costOf: () => 0.1,
  });
}
