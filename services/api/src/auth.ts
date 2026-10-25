/**
 * Sessions (PLAN 4.3): Supabase email OTP. The browser never talks to GoTrue; the API
 * proxies /auth/otp and /auth/verify and verifies the session JWT with the project
 * secret. Roles live on the profile (ops and sharia granted by hand in the database).
 * Dev bypass (never in production): `x-dev-user: <auth user id>` plus optional
 * `x-dev-roles: importer,ops` creates or reuses a profile for tests and local work.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import type { Env } from './env.js';
import { ApiError } from './lib/http.js';
import { verifyJwt } from './lib/jwt.js';
import type { Db } from './db/index.js';
import { profiles } from './db/schema.js';

export type Role = 'investor' | 'importer' | 'ops' | 'sharia';

export interface AuthUser {
  profileId: string;
  authUserId: string;
  email: string | null;
  roles: Role[];
  walletAddress: string | null;
  kycStatus: string;
  displayName: string;
}

export type Vars = { env: Env; user?: AuthUser };

export async function profileFor(db: Db, authUserId: string, email: string | null, roles: Role[] = []): Promise<AuthUser> {
  let row = await db.query.profiles.findFirst({ where: eq(profiles.authUserId, authUserId) });
  if (!row) {
    const inserted = await db
      .insert(profiles)
      .values({ authUserId, email, displayName: email?.split('@')[0] ?? 'user', roles })
      .onConflictDoNothing({ target: profiles.authUserId })
      .returning();
    row = inserted[0] ?? (await db.query.profiles.findFirst({ where: eq(profiles.authUserId, authUserId) }));
  } else if (roles.length && roles.some((r) => !row!.roles.includes(r))) {
    // Dev bypass only: grant the roles named in the header.
    const merged = [...new Set([...row.roles, ...roles])];
    await db.update(profiles).set({ roles: merged }).where(eq(profiles.id, row.id));
    row = { ...row, roles: merged };
  }
  if (!row) throw new ApiError(500, 'profile', 'profile could not be created');
  return { profileId: row.id, authUserId, email: row.email, roles: row.roles as Role[], walletAddress: row.walletAddress, kycStatus: row.kycStatus, displayName: row.displayName };
}

export function authMiddleware(db: Db, env: Env): MiddlewareHandler<{ Variables: Vars }> {
  const bypass = env.NODE_ENV !== 'production' && (env.DEV_AUTH_BYPASS || env.NODE_ENV === 'test' || env.ADAPTER_MODE === 'mock');
  return async (c, next) => {
    const devUser = c.req.header('x-dev-user');
    if (bypass && devUser) {
      const roles = (c.req.header('x-dev-roles') ?? '').split(',').map((r) => r.trim()).filter((r): r is Role => ['investor', 'importer', 'ops', 'sharia'].includes(r));
      c.set('user', await profileFor(db, devUser, c.req.header('x-dev-email') ?? `${devUser}@dev.local`, roles));
      return next();
    }
    const auth = c.req.header('authorization');
    if (auth?.startsWith('Bearer ')) {
      try {
        const claims = await verifyJwt(auth.slice(7), { secret: env.SUPABASE_JWT_SECRET ?? env.JWT_SECRET, jwksUrl: env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json` : undefined, audience: 'authenticated' });
        c.set('user', await profileFor(db, claims.sub, claims.email ?? null));
      } catch (e) {
        throw new ApiError(401, 'unauthorized', `invalid session: ${(e as Error).message}`);
      }
    }
    return next();
  };
}

export function requireUser(c: Context<{ Variables: Vars }>, ...roles: Role[]): AuthUser {
  const u = c.get('user');
  if (!u) throw new ApiError(401, 'unauthorized', 'sign in first');
  if (roles.length && !roles.some((r) => u.roles.includes(r))) throw new ApiError(403, 'forbidden', `needs role ${roles.join(' or ')}`);
  return u;
}

export const isOps = (u: AuthUser | undefined): boolean => Boolean(u && (u.roles.includes('ops') || u.roles.includes('sharia')));
