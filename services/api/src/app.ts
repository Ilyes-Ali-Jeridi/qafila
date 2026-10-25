import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from './lib/logger.js';
import type { Env } from './env.js';
import { health } from './routes/health.js';
import { config } from './routes/config.js';
import { stats } from './routes/stats.js';
import { auth } from './routes/auth.js';
import { wallet } from './routes/wallet.js';
import { kyc } from './routes/kyc.js';
import { faucet } from './routes/faucet.js';
import { deals } from './routes/deals.js';
import { documents } from './routes/documents.js';
import { reports } from './routes/reports.js';
import { shipments } from './routes/shipments.js';
import { ops } from './routes/ops.js';
import { x402 } from './routes/x402.js';
import { wellKnown } from './routes/wellknown.js';

export function createApp(env: Env) {
  const app = new Hono<{ Variables: { env: Env } }>();
  app.use('*', async (c, next) => {
    c.set('env', env);
    await next();
  });
  app.use('*', cors({ origin: (o) => o ?? '*', allowHeaders: ['Content-Type', 'Authorization', 'X-Payment', 'PAYMENT-SIGNATURE'], exposeHeaders: ['X-Payment-Response', 'PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'] }));

  app.route('/health', health);
  app.route('/config', config);
  app.route('/stats', stats);
  app.route('/', auth); // GET /me
  app.route('/wallet', wallet);
  app.route('/kyc', kyc);
  app.route('/faucet', faucet);
  app.route('/deals', deals);
  app.route('/deals', documents);
  app.route('/deals', reports);
  app.route('/deals', shipments);
  app.route('/ops', ops);
  app.route('/x402', x402);
  app.route('/.well-known', wellKnown);

  app.notFound((c) => c.json({ error: { code: 'not_found', message: `no route ${c.req.method} ${c.req.path}` } }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    logger.error({ err, path: c.req.path }, 'unhandled');
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });
  return app;
}

export type App = ReturnType<typeof createApp>;
