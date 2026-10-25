/**
 * Seeds the three demo deals on the deployed contract (PLAN 3.4, FLOWS 9).
 *
 *   pnpm seed [--instance main|e2e] [--tag <text>]
 *
 * Reuses DEMO_IMPORTER_SECRET from .env (creates it when missing). Progress on stderr, JSON on stdout.
 */
import { parseArgs } from 'node:util';
import { seedDeals } from './lib/seed-deals.ts';

const { values } = parseArgs({
  options: {
    instance: { type: 'string', default: 'main' },
    tag: { type: 'string' },
  },
});
const instance = values.instance === 'e2e' ? 'e2e' : 'main';
const tag = values.tag ?? `seed-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

seedDeals({ instance, tag, freshImporter: false, log: (m) => console.error(`[seed] ${m}`) })
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((err: unknown) => {
    console.error(`[seed] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
