/**
 * Every external adapter has the same shape (PLAN 5.4):
 *   call(input, ctx) -> { status: ok | unavailable | error, data, raw, cost, cached, mode }
 * with zod validation of the response, a 10 s timeout, 2 retries with backoff,
 * a 24 h cache keyed by request hash, and a `mock` mode that replays recorded
 * responses from data/fixtures/<adapter>/<hash>.json. Live responses are recorded
 * into the same folder so mocks are real recordings, labelled as mocks in logs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ZodType } from 'zod';
import { logger } from '../lib/logger.js';
import { requestHash } from '../lib/hash.js';
import { HttpError, retryOnTransient, withRetry } from '../lib/retry.js';

export type AdapterMode = 'live' | 'mock';
export type AdapterStatus = 'ok' | 'unavailable' | 'error';

export interface AdapterResult<T> {
  status: AdapterStatus;
  data: T | null;
  raw: unknown;
  cost: number;
  cached: boolean;
  mode: AdapterMode;
  latencyMs: number;
  /** Fixture file used in mock mode (relative to data/fixtures), for the report. */
  fixture: string | null;
  error: string | null;
}

export interface CacheEntry {
  raw: unknown;
  cost: number;
  mode: AdapterMode;
  fixture: string | null;
}

/** 24 h cache (PLAN 5.2). Backed by `external_calls` in the API, in memory in eval and tests. */
export interface AdapterCache {
  get(adapter: string, hash: string): Promise<CacheEntry | null>;
  set(adapter: string, hash: string, entry: CacheEntry, ttlMs: number): Promise<void>;
}

export class MemoryCache implements AdapterCache {
  private readonly m = new Map<string, { entry: CacheEntry; until: number }>();
  async get(adapter: string, hash: string): Promise<CacheEntry | null> {
    const v = this.m.get(`${adapter}:${hash}`);
    if (!v) return null;
    if (v.until < Date.now()) {
      this.m.delete(`${adapter}:${hash}`);
      return null;
    }
    return v.entry;
  }
  async set(adapter: string, hash: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    this.m.set(`${adapter}:${hash}`, { entry, until: Date.now() + ttlMs });
  }
}

export interface AdapterContext {
  mode: AdapterMode;
  cache: AdapterCache | null;
  /** Record live responses as fixtures (default on outside production). */
  record: boolean;
  fixturesDir: string;
}

export const DEFAULT_FIXTURES_DIR = resolve(import.meta.dirname, '../../../../data/fixtures');
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function fixturePath(ctx: AdapterContext, adapter: string, name: string): string {
  return resolve(ctx.fixturesDir, adapter, `${name}.json`);
}

export function readFixture(ctx: AdapterContext, adapter: string, name: string): { raw: unknown; file: string } | null {
  const p = fixturePath(ctx, adapter, name);
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  const raw = parsed !== null && typeof parsed === 'object' && 'response' in parsed ? parsed['response'] : parsed;
  return { raw, file: `${adapter}/${name}.json` };
}

export function writeFixture(ctx: AdapterContext, adapter: string, name: string, input: unknown, response: unknown, meta: Record<string, unknown> = {}): void {
  const dir = resolve(ctx.fixturesDir, adapter);
  mkdirSync(dir, { recursive: true });
  const body = { adapter, recorded_at: new Date().toISOString(), mode: 'live', input, ...meta, response };
  writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(body, null, 2) + '\n');
}

export interface AdapterSpec<I, R, T> {
  name: string;
  /** The part of the input that identifies the request (never secrets). */
  keyOf: (input: I) => unknown;
  /** Human-readable fixture name for mock lookups; defaults to the request hash. */
  fixtureName?: (input: I) => string;
  live: (input: I, signal: AbortSignal) => Promise<unknown>;
  schema: ZodType<R>;
  map: (raw: R, input: I) => T;
  costOf?: (raw: R) => number;
  /** Used in mock mode when no fixture exists; return null for "unavailable". */
  mockFallback?: (input: I, ctx: AdapterContext) => unknown | null;
  ttlMs?: number;
  timeoutMs?: number;
  retries?: number;
  cacheable?: boolean;
}

export type Adapter<I, T> = (input: I, ctx: AdapterContext) => Promise<AdapterResult<T>>;

export function defineAdapter<I, R, T>(spec: AdapterSpec<I, R, T>): Adapter<I, T> {
  const log = logger.child({ adapter: spec.name });
  return async (input, ctx) => {
    const t0 = Date.now();
    const key = spec.keyOf(input);
    const hash = requestHash({ adapter: spec.name, key });
    const fxName = spec.fixtureName ? spec.fixtureName(input) : hash;
    const done = (partial: Omit<AdapterResult<T>, 'latencyMs'>): AdapterResult<T> => {
      const r = { ...partial, latencyMs: Date.now() - t0 };
      log.info({ hash: hash.slice(0, 12), mode: r.mode, status: r.status, cached: r.cached, fixture: r.fixture, ms: r.latencyMs, err: r.error }, r.mode === 'mock' ? 'adapter call (MOCK)' : 'adapter call');
      return r;
    };
    const validate = (raw: unknown, mode: AdapterMode, fixture: string | null, cached: boolean, cost?: number): AdapterResult<T> => {
      const parsed = spec.schema.safeParse(raw);
      if (!parsed.success) {
        return done({ status: 'error', data: null, raw, cost: 0, cached, mode, fixture, error: `response failed validation: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 300)}` });
      }
      return done({ status: 'ok', data: spec.map(parsed.data, input), raw, cost: cost ?? spec.costOf?.(parsed.data) ?? 0, cached, mode, fixture, error: null });
    };

    if (spec.cacheable !== false && ctx.cache) {
      const hit = await ctx.cache.get(spec.name, hash);
      if (hit) return validate(hit.raw, hit.mode, hit.fixture, true, hit.cost);
    }

    if (ctx.mode === 'mock') {
      const fx = readFixture(ctx, spec.name, fxName) ?? (fxName !== hash ? readFixture(ctx, spec.name, hash) : null);
      if (fx) return validate(fx.raw, 'mock', fx.file, false, 0);
      const fallback = spec.mockFallback?.(input, ctx) ?? null;
      if (fallback !== null) return validate(fallback, 'mock', `${spec.name}/<fallback>`, false, 0);
      return done({ status: 'unavailable', data: null, raw: null, cost: 0, cached: false, mode: 'mock', fixture: null, error: `no fixture ${spec.name}/${fxName}.json` });
    }

    try {
      const raw = await withRetry((signal) => spec.live(input, signal), { timeoutMs: spec.timeoutMs ?? 10_000, retries: spec.retries ?? 2, retryOn: retryOnTransient });
      const result = validate(raw, 'live', null, false);
      if (result.status === 'ok') {
        if (spec.cacheable !== false && ctx.cache) await ctx.cache.set(spec.name, hash, { raw, cost: result.cost, mode: 'live', fixture: null }, spec.ttlMs ?? CACHE_TTL_MS);
        if (ctx.record) {
          try {
            writeFixture(ctx, spec.name, fxName, key, raw);
          } catch (e) {
            log.warn({ err: (e as Error).message }, 'fixture write failed');
          }
        }
      }
      return result;
    } catch (err) {
      const e = err as Error;
      const status: AdapterStatus = err instanceof HttpError && err.status < 500 && err.status !== 429 ? 'error' : 'unavailable';
      return done({ status, data: null, raw: null, cost: 0, cached: false, mode: 'live', fixture: null, error: `${e.name}: ${e.message}`.slice(0, 300) });
    }
  };
}

/** Build a context from env-like settings. Per-adapter mode overrides the global one. */
export function adapterContext(opts: { mode: AdapterMode; cache?: AdapterCache | null; record?: boolean; fixturesDir?: string }): AdapterContext {
  return {
    mode: opts.mode,
    cache: opts.cache ?? null,
    record: opts.record ?? (process.env['NODE_ENV'] !== 'production' && process.env['ADAPTER_RECORD'] !== 'false'),
    fixturesDir: opts.fixturesDir ?? process.env['FIXTURES_DIR'] ?? DEFAULT_FIXTURES_DIR,
  };
}
