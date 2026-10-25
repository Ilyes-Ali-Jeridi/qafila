import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

export const ROOT = resolve(import.meta.dirname, '../../..');
/** The cross-track handoff folder: ../.shared next to the worktrees, or .shared in the main checkout. */
export const SHARED = existsSync(resolve(ROOT, '../../.shared')) ? resolve(ROOT, '../../.shared') : resolve(ROOT, '.shared');

/** Tiny .env reader (no dependency). Values already in process.env win. */
export function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const p = resolve(ROOT, '.env');
  if (!existsSync(p)) return out;
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    const hash = v.indexOf(' #');
    if (hash > 0 && !v.startsWith('"')) v = v.slice(0, hash).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

export function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export const sha256hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const fakeTx = () => randomBytes(32).toString('hex');
export const nowIso = () => new Date().toISOString();
export const nowSecs = () => Math.floor(Date.now() / 1000);
export const iso = (secs: number) => new Date(secs * 1000).toISOString();

/** Deterministic, valid Stellar addresses for the mock world. */
export function fakeG(name: string): string {
  return Keypair.fromRawEd25519Seed(createHash('sha256').update(`qafila-mock-g-${name}`).digest()).publicKey();
}
export function fakeC(name: string): string {
  return StrKey.encodeContract(createHash('sha256').update(`qafila-mock-c-${name}`).digest());
}
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
export function randomUuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const DAY = 86_400;
export const HOUR = 3_600;
