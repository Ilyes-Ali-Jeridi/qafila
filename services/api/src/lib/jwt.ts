/**
 * Supabase (GoTrue) JWT verification without extra dependencies: HS256 with the
 * project JWT secret (the self-hosted stack), or ES256 / RS256 through the JWKS
 * endpoint when no secret is configured.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';

export interface JwtClaims {
  sub: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  [k: string]: unknown;
}

const b64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function decodeJwt(token: string): { header: Record<string, unknown>; claims: JwtClaims; signingInput: string; signature: Buffer } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts as [string, string, string];
  return { header: JSON.parse(b64url(h).toString('utf8')) as Record<string, unknown>, claims: JSON.parse(b64url(p).toString('utf8')) as JwtClaims, signingInput: `${h}.${p}`, signature: b64url(s) };
}

const jwksCache = new Map<string, { keys: JsonWebKey[]; until: number }>();

async function fetchJwks(url: string): Promise<JsonWebKey[]> {
  const hit = jwksCache.get(url);
  if (hit && hit.until > Date.now()) return hit.keys;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const j = (await res.json()) as { keys: JsonWebKey[] };
  jwksCache.set(url, { keys: j.keys, until: Date.now() + 10 * 60 * 1000 });
  return j.keys;
}

export async function verifyJwt(token: string, opts: { secret?: string; jwksUrl?: string; audience?: string; now?: number }): Promise<JwtClaims> {
  const { header, claims, signingInput, signature } = decodeJwt(token);
  const alg = String(header['alg'] ?? '');
  let ok = false;
  if (alg === 'HS256') {
    if (!opts.secret) throw new Error('no jwt secret configured');
    const expected = createHmac('sha256', opts.secret).update(signingInput).digest();
    ok = expected.length === signature.length && timingSafeEqual(expected, signature);
  } else if (alg === 'ES256' || alg === 'RS256') {
    if (!opts.jwksUrl) throw new Error('no jwks url configured');
    const keys = await fetchJwks(opts.jwksUrl);
    const kid = header['kid'] as string | undefined;
    const candidates = keys.filter((k) => !kid || (k as { kid?: string }).kid === kid);
    for (const jwk of candidates) {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      ok = cryptoVerify('sha256', Buffer.from(signingInput), alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, signature);
      if (ok) break;
    }
  } else throw new Error(`unsupported alg ${alg}`);
  if (!ok) throw new Error('bad signature');
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (claims.exp !== undefined && claims.exp < now) throw new Error('token expired');
  if (opts.audience) {
    const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (aud.length && !aud.includes(opts.audience)) throw new Error('bad audience');
  }
  if (!claims.sub) throw new Error('no subject');
  return claims;
}

/** Mint an HS256 token (tests and the dev bypass helper). */
export function signHs256(claims: JwtClaims, secret: string): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(claims)}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}
