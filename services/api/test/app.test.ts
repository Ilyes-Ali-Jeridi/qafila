import { describe, expect, it } from 'vitest';
import { HealthSchema, PublicConfigSchema } from '@qafila/shared';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

const env = loadEnv({ STELLAR_NETWORK: 'testnet', ADAPTER_MODE: 'mock', FF_X402: 'true', APP_DOMAIN: 'qafila.dev' });
const app = createApp(env);

describe('scaffold routes', () => {
  it('GET /config is schema-valid and carries flags and the passkey domain', async () => {
    const res = await app.request('/config');
    expect(res.status).toBe(200);
    const cfg = PublicConfigSchema.parse(await res.json());
    expect(cfg.network).toBe('testnet');
    expect(cfg.flags.FF_X402).toBe(true);
    expect(cfg.flags.FF_ANCHOR).toBe(false);
    expect(cfg.smartAccount.rpId).toBe('qafila.dev');
    expect(cfg.settlementToken.label).toBe('test dollars');
  });

  it('GET /health is schema-valid', async () => {
    const res = await app.request('/health');
    const body = HealthSchema.parse(await res.json());
    expect(body.adapters['shipsgo']).toBe('mock');
  });

  it('data routes are not mounted without services (404 envelope)', async () => {
    const res = await app.request('/deals');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('unknown routes answer 404', async () => {
    expect((await app.request('/nope')).status).toBe(404);
  });
});
