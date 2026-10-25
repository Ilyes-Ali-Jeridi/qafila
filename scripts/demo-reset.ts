/**
 * Lists fresh copies of the three demo deals on the SAME contract (PLAN 13.2).
 * Never redeploys, so venue wallets, approvals and positions survive. A fresh demo
 * importer is created each time so the importer limit never blocks a reset; the
 * previous demo deals stay on-chain as history.
 *
 *   pnpm demo-reset [--instance main|e2e]
 */
import { parseArgs } from 'node:util';
import { seedDeals } from './lib/seed-deals.ts';

const { values } = parseArgs({ options: { instance: { type: 'string', default: 'main' } } });
const instance = values.instance === 'e2e' ? 'e2e' : 'main';
const tag = `reset-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

seedDeals({ instance, tag, freshImporter: true, log: (m) => console.error(`[demo-reset] ${m}`) })
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((err: unknown) => {
    console.error(`[demo-reset] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
