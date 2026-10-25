import { Hono } from 'hono';
import { HealthSchema } from '@qafila/shared';
import type { Env } from '../env.js';
import { reply } from '../lib/http.js';

export const health = new Hono<{ Variables: { env: Env } }>();

export async function rpcProbe(url: string): Promise<{ ok: boolean; latencyMs: number | null; protocol: number | null }> {
  const t = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersionInfo' }),
      signal: AbortSignal.timeout(4000),
    });
    const j = (await r.json()) as { result?: { protocolVersion?: number } };
    return { ok: r.ok, latencyMs: Date.now() - t, protocol: j.result?.protocolVersion ?? null };
  } catch {
    return { ok: false, latencyMs: null, protocol: null };
  }
}

export function adapterModes(env: Env): Record<string, 'live' | 'mock' | 'off'> {
  const mode = (specific: 'live' | 'mock' | undefined, key: string | undefined, keyless = false): 'live' | 'mock' | 'off' => {
    const m = specific ?? env.ADAPTER_MODE;
    if (m === 'mock') return 'mock';
    return keyless || key ? 'live' : 'off';
  };
  return {
    llm: mode(env.LLM_MODE, env.LLM_PROVIDER === 'bedrock' ? 'aws' : env.ANTHROPIC_API_KEY),
    shipsgo: mode(env.SHIPSGO_MODE, env.SHIPSGO_API_KEY),
    opensanctions: mode(env.OPENSANCTIONS_MODE, env.OPENSANCTIONS_API_KEY),
    registry: mode(env.REGISTRY_MODE, undefined, true),
    reflector: env.FF_REFLECTOR ? 'live' : 'off',
    resend: env.RESEND_API_KEY ? 'live' : 'off',
  };
}

health.get('/', async (c) => {
  const env = c.get('env');
  const rpc = await rpcProbe(env.STELLAR_RPC_URL);
  // ponytail: db probe lands with the database module (Track B); until then it reports off.
  const db = { ok: Boolean(env.DATABASE_URL), latencyMs: null };
  return reply(c, HealthSchema, {
    ok: rpc.ok,
    time: new Date().toISOString(),
    rpc,
    db,
    indexerLagSecs: null,
    adapters: adapterModes(env),
    version: process.env['npm_package_version'] ?? '0.1.0',
  });
});
