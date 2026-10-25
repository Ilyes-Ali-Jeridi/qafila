/** Helpers shared by the route files. */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { DocumentRecord } from '@qafila/shared';
import type { AuthUser, Vars } from '../auth.js';
import { deals, documents } from '../db/schema.js';
import { ApiError } from '../lib/http.js';
import type { Services } from '../services.js';
import { loadDeal, type DealRow } from '../services/deals.js';

export type { Vars };
export type Ctx = Context<{ Variables: Vars }>;

/** `GET /deals/:id` accepts the deal uuid or its number. */
export async function findDeal(svc: Services, idOrNumber: string): Promise<DealRow> {
  if (/^\d+$/.test(idOrNumber)) {
    const row = await svc.db.query.deals.findFirst({ where: eq(deals.number, Number(idOrNumber)) });
    if (!row) throw new ApiError(404, 'not_found', 'deal not found');
    return row;
  }
  if (!/^[0-9a-f-]{36}$/i.test(idOrNumber)) throw new ApiError(404, 'not_found', 'deal not found');
  return loadDeal(svc.db, idOrNumber);
}

export function assertOwnerOrOps(deal: DealRow, user: AuthUser): void {
  const ops = user.roles.includes('ops') || user.roles.includes('sharia');
  if (!ops && deal.importerId !== user.profileId) throw new ApiError(403, 'forbidden', 'not your deal');
}

export async function documentRecords(svc: Services, dealId: string, withUrls: boolean): Promise<DocumentRecord[]> {
  const rows = await svc.db.query.documents.findMany({ where: eq(documents.dealId, dealId), orderBy: (d, { desc }) => [desc(d.createdAt)] });
  const out: DocumentRecord[] = [];
  for (const r of rows) {
    if (r.status === 'replaced') continue;
    out.push({
      id: r.id,
      type: r.type as DocumentRecord['type'],
      filename: r.storagePath.split('/').pop() ?? r.type,
      mime: r.mime,
      size: r.size,
      sha256: r.sha256,
      pages: r.pages,
      stage: r.stage as DocumentRecord['stage'],
      status: r.status === 'uploaded' ? 'uploaded' : 'pending_upload',
      uploadedAt: r.createdAt.toISOString(),
      viewUrl: withUrls && r.status === 'uploaded' ? await svc.adapters.storage.signedUrl(r.storagePath, 15 * 60) : null,
    });
  }
  return out;
}

export async function readJson<T>(c: Ctx, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown } } }): Promise<T> {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(422, 'invalid_body', 'request body failed validation', parsed.error.issues);
  return parsed.data;
}

export const nowSecs = (): number => Math.floor(Date.now() / 1000);
