/** In-memory sliding-window rate limits per key (IP or user). One process, no Redis (PLAN 8.1). */
import type { Context, MiddlewareHandler } from 'hono';
import { ApiError } from './http.js';

const buckets = new Map<string, number[]>();

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const arr = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 50_000) buckets.clear();
  return true;
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'local';
}

export function rateLimit(name: string, limit: number, windowMs: number, keyOf: (c: Context) => string = clientIp): MiddlewareHandler {
  return async (c, next) => {
    if (process.env['RATE_LIMIT'] === 'off') return next();
    if (!hit(`${name}:${keyOf(c)}`, limit, windowMs)) throw new ApiError(429, 'rate_limited', `too many requests (${name})`);
    await next();
  };
}

export const resetRateLimits = (): void => buckets.clear();
