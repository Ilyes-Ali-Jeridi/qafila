import { serve } from '@hono/node-server';
import { env } from './env.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';

const app = createApp(env);
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, network: env.STELLAR_NETWORK, contract: env.QAFILA_CONTRACT_ID ?? null }, 'qafila api up');
});
