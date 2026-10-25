import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { HealthSchema } from '@qafila/shared';
import { authMiddleware } from './auth.js';
import type { Env } from './env.js';
import { loadDeployment } from './env.js';
import { indexerLagSecs } from './jobs/indexer.js';
import { logger } from './lib/logger.js';
import { reply } from './lib/http.js';
import { relayerApp } from './relayer.js';
import { auth } from './routes/auth.js';
import { config } from './routes/config.js';
import { dealRoutes } from './routes/deals.js';
import { adapterModes, rpcProbe } from './routes/health.js';
import { ops } from './routes/ops.js';
import { publicRoutes } from './routes/public.js';
import { wellKnown } from './routes/wellknown.js';
import { x402 } from './routes/x402.js';
import type { Vars } from './routes/_shared.js';
import type { Services } from './services.js';

export function createApp(env: Env, svc?: Services) {
  const app = new Hono<{ Variables: Vars }>();
  app.use('*', async (c, next) => {
    c.set('env', env);
    if (svc) c.set('svc', svc);
    await next();
  });
  app.use('*', cors({ origin: (o) => o ?? '*', allowHeaders: ['Content-Type', 'Authorization', 'X-Payment', 'PAYMENT-SIGNATURE', 'X-Wallet-Address', 'X-Dev-User', 'X-Dev-Roles', 'X-Dev-Email'], exposeHeaders: ['X-Payment-Response', 'PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'] }));

  app.get('/health', async (c) => {
    const rpc = await rpcProbe(env.STELLAR_RPC_URL);
    let db = { ok: false, latencyMs: null as number | null };
    let lag: number | null = null;
    if (svc) {
      const t = Date.now();
      try {
        await svc.db.execute('select 1');
        db = { ok: true, latencyMs: Date.now() - t };
        lag = await indexerLagSecs(svc);
      } catch {
        db = { ok: false, latencyMs: null };
      }
    }
    return reply(c, HealthSchema, { ok: rpc.ok && (svc ? db.ok : true), time: new Date().toISOString(), rpc, db, indexerLagSecs: lag, adapters: svc ? { ...svc.adapters.modes, chain: svc.chain.mode } : adapterModes(env), version: process.env['npm_package_version'] ?? '0.1.0' });
  });
  app.route('/config', config);
  app.route('/.well-known', wellKnown);

  if (svc) {
    app.use('*', authMiddleware(svc.db, env));
    app.route('/', auth);
    app.route('/', dealRoutes);
    app.route('/', publicRoutes);
    app.route('/ops', ops);
    if (env.FF_X402) app.route('/x402', x402);
    if (env.RELAYER_SECRET) {
      const dep = loadDeployment(env.STELLAR_NETWORK);
      const contractId = env.QAFILA_CONTRACT_ID ?? dep.contractId;
      app.route(
        '/relayer',
        relayerApp(
          {
            secret: env.RELAYER_SECRET,
            rpcUrl: env.STELLAR_RPC_URL,
            networkPassphrase: env.NETWORK_PASSPHRASE,
            allowedContracts: [contractId, env.SETTLEMENT_TOKEN_ID ?? dep.settlementToken?.id, process.env['PROBE_CONTRACT_ID']].filter((x): x is string => Boolean(x)),
            allowedWasmHashes: [env.SMART_ACCOUNT_WASM_HASH].filter((x): x is string => Boolean(x)),
            maxResourceFeeStroops: BigInt(process.env['RELAYER_MAX_RESOURCE_FEE'] ?? '500000000'),
            inclusionFeeStroops: process.env['RELAYER_INCLUSION_FEE'] ?? '100000',
            perIpPerMinute: Number(process.env['RELAYER_PER_IP_PER_MINUTE'] ?? '30'),
          },
          (m) => logger.info(m),
        ),
      );
    }
  }

  app.notFound((c) => c.json({ error: { code: 'not_found', message: `no route ${c.req.method} ${c.req.path}` } }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    logger.error({ err, path: c.req.path }, 'unhandled');
    return c.json({ error: { code: 'internal', message: (err as Error).message?.slice(0, 200) || 'internal error' } }, 500);
  });
  return app;
}

export type App = ReturnType<typeof createApp>;
