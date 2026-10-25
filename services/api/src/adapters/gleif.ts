/**
 * GLEIF LEI lookup by Chinese Unified Social Credit Code (PLAN 5.4). Live, free, no key:
 *   GET https://api.gleif.org/api/v1/lei-records?filter[entity.registeredAs]=<USCC>
 * Coverage is limited to companies with an LEI (about 100,700 active in China), so
 * most small factories are "not found" (review, not reject).
 */
import { z } from 'zod';
import { defineAdapter } from './base.js';
import { fetchJson } from '../lib/retry.js';

const Name = z.object({ name: z.string(), language: z.string().nullable().optional(), type: z.string().optional() });

export const GleifResponseSchema = z.object({
  data: z.array(
    z.object({
      type: z.string().optional(),
      id: z.string().optional(),
      attributes: z.object({
        lei: z.string(),
        entity: z.object({
          legalName: Name,
          otherNames: z.array(Name).optional().default([]),
          transliteratedOtherNames: z.array(Name).optional().default([]),
          registeredAs: z.string().nullable().optional(),
          status: z.string().nullable().optional(),
          legalAddress: z.object({ addressLines: z.array(z.string()).optional(), city: z.string().nullable().optional(), region: z.string().nullable().optional(), country: z.string().nullable().optional(), postalCode: z.string().nullable().optional() }).partial(),
        }),
        registration: z.object({ status: z.string().nullable().optional(), initialRegistrationDate: z.string().nullable().optional(), lastUpdateDate: z.string().nullable().optional(), nextRenewalDate: z.string().nullable().optional() }).partial(),
      }),
    }),
  ),
});
export type GleifResponse = z.infer<typeof GleifResponseSchema>;

export interface RegistryLookup {
  found: boolean;
  lei: string | null;
  legalNameZh: string | null;
  legalNameEn: string | null;
  entityStatus: string | null; // ACTIVE | INACTIVE | NULL
  leiStatus: string | null; // ISSUED | LAPSED | RETIRED | ...
  registeredAt: string | null;
  lastUpdate: string | null;
  address: string | null;
  country: string | null;
  legalRepresentative: string | null;
  businessScope: string | null;
  registeredAs: string | null;
}

const isZh = (s: string): boolean => /[㐀-鿿]/.test(s);

export function mapGleif(raw: GleifResponse, uscc: string): RegistryLookup {
  const rec = raw.data.find((d) => (d.attributes.entity.registeredAs ?? '').toUpperCase() === uscc.toUpperCase() && (d.attributes.entity.legalAddress.country ?? '') === 'CN') ?? raw.data.find((d) => (d.attributes.entity.legalAddress.country ?? '') === 'CN');
  if (!rec) {
    return { found: false, lei: null, legalNameZh: null, legalNameEn: null, entityStatus: null, leiStatus: null, registeredAt: null, lastUpdate: null, address: null, country: null, legalRepresentative: null, businessScope: null, registeredAs: null };
  }
  const a = rec.attributes;
  const names = [a.entity.legalName, ...a.entity.otherNames];
  const zh = names.find((n) => n.language === 'zh' && isZh(n.name)) ?? names.find((n) => isZh(n.name));
  const en = names.find((n) => n.language === 'en') ?? names.find((n) => !isZh(n.name) && (n.type ?? '').includes('LEGAL_NAME')) ?? names.find((n) => !isZh(n.name));
  const addr = a.entity.legalAddress;
  const address = [...(addr.addressLines ?? []), addr.city ?? '', addr.region ?? '', addr.postalCode ?? ''].filter(Boolean).join(', ') || null;
  return {
    found: true,
    lei: a.lei,
    legalNameZh: zh?.name ?? null,
    legalNameEn: en?.name ?? null,
    entityStatus: a.entity.status ?? null,
    leiStatus: a.registration.status ?? null,
    registeredAt: a.registration.initialRegistrationDate ?? null,
    lastUpdate: a.registration.lastUpdateDate ?? null,
    address,
    country: addr.country ?? null,
    legalRepresentative: null,
    businessScope: null,
    registeredAs: a.entity.registeredAs ?? null,
  };
}

export const gleifLookup = defineAdapter<{ uscc: string }, GleifResponse, RegistryLookup>({
  name: 'gleif',
  keyOf: (i) => ({ uscc: i.uscc.toUpperCase() }),
  fixtureName: (i) => i.uscc.toUpperCase(),
  live: (i, signal) => fetchJson(`https://api.gleif.org/api/v1/lei-records?filter%5Bentity.registeredAs%5D=${encodeURIComponent(i.uscc.toUpperCase())}&page%5Bsize%5D=5`, { headers: { accept: 'application/vnd.api+json' }, signal }),
  schema: GleifResponseSchema,
  map: (raw, i) => mapGleif(raw, i.uscc),
});
