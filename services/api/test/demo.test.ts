/** Demo mode (FF_DEMO_MODE): a persona session is narrowed to the persona's roles and cannot write. Needs DATABASE_URL; skipped otherwise. */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DemoSessionResponseSchema, MeSchema } from '@qafila/shared';
import { createApp, type App } from '../src/app.js';
import { profiles } from '../src/db/schema.js';
import { loadEnv } from '../src/env.js';
import { createServices, type Services } from '../src/services.js';

const hasDb = Boolean(process.env['DATABASE_URL']);
const AUTH_USER = 'demo-profile-test';
const json = { 'content-type': 'application/json' };

describe.skipIf(!hasDb)('demo sessions', () => {
  let svc: Services;
  let app: App;

  beforeAll(async () => {
    process.env['FF_DEMO_MODE'] = 'true';
    process.env['DEMO_PROFILE_AUTH_USER_ID'] = AUTH_USER;
    process.env['JWT_SECRET'] = process.env['SUPABASE_JWT_SECRET'] ?? 'test-secret-test-secret-test-secret';
    const env = loadEnv(process.env);
    svc = createServices(env);
    await svc.db.delete(profiles).where(eq(profiles.authUserId, AUTH_USER));
    await svc.db.insert(profiles).values({ authUserId: AUTH_USER, email: 'demo@dev.local', displayName: 'Demo', roles: ['importer', 'ops', 'sharia', 'investor'], walletAddress: 'GDEMOPROFILEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    app = createApp(env, svc);
  }, 30_000);

  afterAll(async () => {
    await svc.db.delete(profiles).where(eq(profiles.authUserId, AUTH_USER));
  });

  const session = async (persona: string) => {
    const res = await app.request('/demo/session', { method: 'POST', headers: json, body: JSON.stringify({ persona }) });
    return { status: res.status, body: (await res.json()) as unknown };
  };

  it('mints an importer session narrowed to the importer role', async () => {
    const r = await session('importer');
    expect(r.status).toBe(200);
    const s = DemoSessionResponseSchema.parse(r.body);
    expect(s.roles).toEqual(['importer']);
    const me = await app.request('/me', { headers: { authorization: `Bearer ${s.token}` } });
    expect(me.status).toBe(200);
    expect(MeSchema.parse(await me.json()).profile.roles).toEqual(['importer']);
  });

  it('narrows the ops persona to ops and sharia', async () => {
    const s = DemoSessionResponseSchema.parse((await session('ops')).body);
    expect(s.roles).toEqual(['ops', 'sharia']);
  });

  it('refuses writes from a demo session', async () => {
    const s = DemoSessionResponseSchema.parse((await session('ops')).body);
    const w = await app.request('/kyb', { method: 'POST', headers: { ...json, authorization: `Bearer ${s.token}` }, body: JSON.stringify({}) });
    expect(w.status).toBe(403);
    expect(((await w.json()) as { error: { code: string } }).error.code).toBe('demo_readonly');
  });

  it('rejects unknown personas', async () => {
    expect((await session('admin')).status).toBe(422);
  });
});
