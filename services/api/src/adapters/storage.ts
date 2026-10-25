/**
 * Document storage (PLAN 5.2 Intake): private, signed URLs only. Two modes:
 *  - supabase: Supabase Storage bucket `documents` through the REST API with the service role key
 *  - local: data/uploads/ on disk (mock mode, CI, development); "signed" URLs are API routes
 *    with an HMAC token that the documents route checks.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { logger } from '../lib/logger.js';
import { fetchJson, HttpError } from '../lib/retry.js';

export interface Storage {
  readonly mode: 'supabase' | 'local';
  put(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  /** A URL a browser can open for `ttlSecs`; null when the backend cannot sign. */
  signedUrl(path: string, ttlSecs: number): Promise<string | null>;
}

export const DEFAULT_UPLOADS_DIR = resolve(import.meta.dirname, '../../../../data/uploads');

const safe = (p: string): string => {
  if (p.includes('..') || p.startsWith('/')) throw new Error('invalid storage path');
  return p;
};

export function signLocalToken(secret: string, path: string, exp: number): string {
  return createHmac('sha256', secret).update(`${path}:${exp}`).digest('base64url');
}

export function verifyLocalToken(secret: string, path: string, exp: number, token: string): boolean {
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signLocalToken(secret, path, exp));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function createLocalStorage(opts: { dir?: string; apiBaseUrl: string; secret: string }): Storage {
  const dir = opts.dir ?? process.env['UPLOADS_DIR'] ?? DEFAULT_UPLOADS_DIR;
  mkdirSync(dir, { recursive: true });
  return {
    mode: 'local',
    async put(path, bytes) {
      const full = resolve(dir, safe(path));
      mkdirSync(dirname(full), { recursive: true });
      await writeFile(full, bytes);
    },
    async get(path) {
      return new Uint8Array(await readFile(resolve(dir, safe(path))));
    },
    async remove(path) {
      const full = resolve(dir, safe(path));
      if (existsSync(full)) await unlink(full);
    },
    async signedUrl(path, ttlSecs) {
      const exp = Math.floor(Date.now() / 1000) + ttlSecs;
      return `${opts.apiBaseUrl.replace(/\/$/, '')}/files/${encodeURIComponent(safe(path))}?exp=${exp}&token=${signLocalToken(opts.secret, path, exp)}`;
    },
  };
}

export function createSupabaseStorage(opts: { url: string; serviceRoleKey: string; bucket?: string }): Storage {
  const bucket = opts.bucket ?? 'documents';
  const base = `${opts.url.replace(/\/$/, '')}/storage/v1`;
  const headers = { authorization: `Bearer ${opts.serviceRoleKey}`, apikey: opts.serviceRoleKey };
  const log = logger.child({ adapter: 'storage' });
  return {
    mode: 'supabase',
    async put(path, bytes, mime) {
      const res = await fetch(`${base}/object/${bucket}/${safe(path)}`, { method: 'POST', headers: { ...headers, 'content-type': mime, 'x-upsert': 'true' }, body: new Blob([bytes as BlobPart]), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new HttpError(res.status, await res.text(), 'supabase storage put');
    },
    async get(path) {
      const res = await fetch(`${base}/object/${bucket}/${safe(path)}`, { headers, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new HttpError(res.status, await res.text(), 'supabase storage get');
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove(path) {
      const res = await fetch(`${base}/object/${bucket}`, { method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [safe(path)] }), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) log.warn({ status: res.status }, 'supabase storage remove failed');
    },
    async signedUrl(path, ttlSecs) {
      try {
        const j = (await fetchJson(`${base}/object/sign/${bucket}/${safe(path)}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: ttlSecs }), signal: AbortSignal.timeout(15_000) })) as { signedURL?: string; signedUrl?: string };
        const rel = j.signedURL ?? j.signedUrl;
        return rel ? `${base}${rel.startsWith('/') ? '' : '/'}${rel}` : null;
      } catch (e) {
        log.warn({ err: (e as Error).message }, 'signed url failed');
        return null;
      }
    },
  };
}

export async function ensureBucket(opts: { url: string; serviceRoleKey: string; bucket?: string }): Promise<void> {
  const bucket = opts.bucket ?? 'documents';
  const base = `${opts.url.replace(/\/$/, '')}/storage/v1`;
  const headers = { authorization: `Bearer ${opts.serviceRoleKey}`, apikey: opts.serviceRoleKey, 'content-type': 'application/json' };
  const res = await fetch(`${base}/bucket/${bucket}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (res.ok) return;
  const create = await fetch(`${base}/bucket`, { method: 'POST', headers, body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 15 * 1024 * 1024 }), signal: AbortSignal.timeout(15_000) });
  if (!create.ok) throw new HttpError(create.status, await create.text(), 'supabase create bucket');
}
