/** `pnpm --filter ./services/api worker`: the job loop on its own (PLAN 8.4). */
import { env } from './env.js';
import { createServices } from './services.js';
import { startWorker } from './jobs/worker.js';
import { logger } from './lib/logger.js';

const svc = createServices(env);
startWorker(svc);
logger.info({ chain: svc.chain.mode }, 'qafila worker up');
