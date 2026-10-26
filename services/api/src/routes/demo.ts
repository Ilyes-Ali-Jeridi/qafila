/**
 * Demo mode (FF_DEMO_MODE, testnet only): judges browse the app as one persona of the demo
 * profile without a passkey or an email code. The session is an ordinary HS256 session for
 * that profile, narrowed to the persona's roles and read-only (authMiddleware refuses writes).
 * Anything that moves money still needs a real wallet: the tour sends people to /join for that.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { DemoSessionRequestSchema, DemoSessionResponseSchema } from '@qafila/shared';
import { profiles } from '../db/schema.js';
import { ApiError, reply } from '../lib/http.js';
import { signHs256 } from '../lib/jwt.js';
import { rateLimit } from '../lib/ratelimit.js';
import { readJson, type Vars } from './_shared.js';

export const demoRoutes = new Hono<{ Variables: Vars }>();

const PERSONAS = {
  importer: { roles: ['importer'], label: 'Demo: importer' },
  ops: { roles: ['ops', 'sharia'], label: 'Demo: ops' },
} as const;

const SESSION_SECS = 2 * 3600;

demoRoutes.post('/demo/session', rateLimit('demo', 120, 10 * 60 * 1000), async (c) => {
  const env = c.get('env');
  if (env.STELLAR_NETWORK === 'mainnet') throw new ApiError(404, 'not_found', 'no demo on mainnet');
  const secret = env.SUPABASE_JWT_SECRET ?? env.JWT_SECRET;
  if (!secret || !env.DEMO_PROFILE_AUTH_USER_ID) throw new ApiError(503, 'demo_unavailable', 'demo mode is not configured on this server');
  const { persona } = await readJson(c, DemoSessionRequestSchema);
  const p = await c.get('svc').db.query.profiles.findFirst({ where: eq(profiles.authUserId, env.DEMO_PROFILE_AUTH_USER_ID) });
  if (!p?.walletAddress) throw new ApiError(503, 'demo_unavailable', 'the demo profile is missing or has no wallet');
  const def = PERSONAS[persona];
  const roles = def.roles.filter((r) => p.roles.includes(r));
  if (!roles.length) throw new ApiError(503, 'demo_unavailable', `the demo profile has no ${persona} role`);
  const now = Math.floor(Date.now() / 1000);
  const token = signHs256({ sub: env.DEMO_PROFILE_AUTH_USER_ID, email: p.email ?? undefined, aud: 'authenticated', role: 'authenticated', demo: true, demo_roles: roles, iat: now, exp: now + SESSION_SECS }, secret);
  return reply(c, DemoSessionResponseSchema, { token, address: p.walletAddress, label: def.label, roles, expiresAt: new Date((now + SESSION_SECS) * 1000).toISOString() });
});
