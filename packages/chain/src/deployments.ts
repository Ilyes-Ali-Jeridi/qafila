/** deployments/testnet.json and deployments/testnet-e2e.json (PLAN 3.4), zod-validated. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { repoRoot } from './env.ts';

const G = z.string().regex(/^G[A-Z2-7]{55}$/, 'G address');
const C = z.string().regex(/^C[A-Z2-7]{55}$/, 'C address');
const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, '32 bytes hex');
const Amount = z.string().regex(/^\d+$/, 'i128 decimal string');

export const DeploymentConfigSchema = z.object({
  max_markup_bps: z.number().int().nonnegative(),
  max_deposit_bps: z.number().int().nonnegative(),
  max_investors_per_deal: z.number().int().positive(),
  min_tenor_secs: z.number().int().nonnegative(),
  grace_secs: z.number().int().nonnegative(),
  base_importer_limit: Amount,
  limit_step: Amount,
  min_security_bps: z.number().int().nonnegative(),
  security_step_bps: z.number().int().nonnegative(),
  security_floor_bps: z.number().int().nonnegative(),
  max_extension_secs: z.number().int().nonnegative(),
});
export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

export const DeploymentFileSchema = z.object({
  network: z.enum(['local', 'testnet', 'mainnet']),
  instance: z.enum(['main', 'e2e']),
  contractId: C,
  wasmHash: Hex64,
  verifierPublicKeyHex: Hex64,
  verifierPublicKey: G,
  admin: G,
  agent: z.union([G, C]),
  agentSmartAccountId: C.optional(),
  charity: G,
  treasury: G,
  settlementToken: z.object({ id: C, code: z.string().min(1).max(12), issuer: G }),
  coinvest: G.optional(),
  probeContractId: C.optional(),
  gitCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  deployedAt: z.string().datetime({ offset: true }),
  config: DeploymentConfigSchema,
  txs: z.record(z.string(), z.string()).default({}),
});
export type DeploymentFile = z.infer<typeof DeploymentFileSchema>;

export type DeploymentInstance = 'main' | 'e2e';

export function deploymentPath(instance: DeploymentInstance, network = 'testnet', root = repoRoot()): string {
  const name = instance === 'main' ? `${network}.json` : `${network}-${instance}.json`;
  return resolve(root, 'deployments', name);
}

export function loadDeployment(instance: DeploymentInstance = 'main', network = 'testnet'): DeploymentFile {
  const path = deploymentPath(instance, network);
  if (!existsSync(path)) throw new Error(`deployment file missing: ${path} (run pnpm deploy:testnet${instance === 'e2e' ? ' --instance e2e' : ''})`);
  return DeploymentFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function tryLoadDeployment(instance: DeploymentInstance = 'main', network = 'testnet'): DeploymentFile | null {
  const path = deploymentPath(instance, network);
  if (!existsSync(path)) return null;
  return DeploymentFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeDeployment(file: DeploymentFile): string {
  const parsed = DeploymentFileSchema.parse(file);
  const path = deploymentPath(parsed.instance, parsed.network);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return path;
}
