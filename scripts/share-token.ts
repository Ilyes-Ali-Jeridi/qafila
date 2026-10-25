/**
 * Share-token factory CLI (PLAN 3.1). Prints the result as JSON on stdout.
 *
 *   pnpm share-token --deal 42 [--admin C...] [--home-domain qafila.dev]
 *
 * `--admin` defaults to QAFILA_CONTRACT_ID from .env (deployments/testnet.json wins when present).
 * Progress goes to stderr; no secret is ever printed.
 */
import { parseArgs } from 'node:util';
import { createShareToken, loadChainEnv, tryLoadDeployment } from '@qafila/chain';

const { values } = parseArgs({
  options: {
    deal: { type: 'string', short: 'd' },
    admin: { type: 'string', short: 'a' },
    'home-domain': { type: 'string' },
    instance: { type: 'string', default: 'main' },
  },
});

const dealNumber = Number(values.deal);
if (!Number.isInteger(dealNumber) || dealNumber < 1) {
  console.error('usage: pnpm share-token --deal <n> [--admin C...] [--home-domain domain] [--instance main|e2e]');
  process.exit(2);
}

const env = loadChainEnv();
const instance = values.instance === 'e2e' ? 'e2e' : 'main';
const admin = values.admin ?? tryLoadDeployment(instance)?.contractId ?? env.QAFILA_CONTRACT_ID;
if (!admin) {
  console.error('no admin contract: pass --admin or deploy first (deployments/testnet.json or QAFILA_CONTRACT_ID)');
  process.exit(2);
}

createShareToken({
  dealNumber,
  adminContractId: admin,
  env,
  homeDomain: values['home-domain'],
  onStep: (step, detail) => console.error(`[share-token] ${step}: ${detail}`),
})
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((err: unknown) => {
    console.error(`[share-token] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
