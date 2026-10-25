import { serve } from '@hono/node-server';
import { env } from './env.js';
import { createApp } from './app.js';
import { createServices } from './services.js';
import { startWorker } from './jobs/worker.js';
import { logger } from './lib/logger.js';
import { ensureBucket } from './adapters/storage.js';

const svc = createServices(env);
if (env.STORAGE_MODE === 'supabase' && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  ensureBucket({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }).catch((e) => logger.warn({ err: (e as Error).message }, 'documents bucket check failed'));
}
const app = createApp(env, svc);
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, network: env.STELLAR_NETWORK, contract: svc.contractId, chain: svc.chain.mode, worker: env.WORKER }, 'qafila api up');
});
if (env.WORKER) startWorker(svc);
