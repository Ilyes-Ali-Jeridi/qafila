/**
 * Chain environment: reads the repo-root `.env` (never logs it) and validates with zod.
 * Node only.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

export type NetworkName = 'local' | 'testnet' | 'mainnet';

export interface NetworkConfig {
  network: NetworkName;
  rpcUrl: string;
  horizonUrl: string;
  passphrase: string;
}

/** Walk up from this file until the pnpm workspace file is found. */
export function repoRoot(from: string = import.meta.dirname): string {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root not found (pnpm-workspace.yaml)');
}

const Secret = z.string().regex(/^S[A-Z2-7]{55}$/, 'Stellar secret seed').optional();
const GAddr = z.string().regex(/^G[A-Z2-7]{55}$/, 'G address');
const CAddr = z.string().regex(/^C[A-Z2-7]{55}$/, 'C address');

export const ChainEnvSchema = z.object({
  STELLAR_NETWORK: z.enum(['local', 'testnet', 'mainnet']).default('testnet'),
  STELLAR_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
  NETWORK_PASSPHRASE: z.string().min(1).default('Test SDF Network ; September 2015'),

  QAFILA_CONTRACT_ID: CAddr.optional(),
  SETTLEMENT_TOKEN_ID: CAddr.optional(),
  SETTLEMENT_TOKEN_CODE: z.string().min(1).max(12).default('qUSD'),
  SETTLEMENT_TOKEN_ISSUER: GAddr.optional(),
  PROBE_CONTRACT_ID: CAddr.optional(),
  CHARITY_ADDRESS: GAddr.optional(),
  TREASURY_ADDRESS: GAddr.optional(),

  ADMIN_SECRET: Secret,
  VERIFIER_ED25519_SECRET: Secret,
  AGENT_SIGNER_SECRET: Secret,
  AGENT_SMART_ACCOUNT_ID: CAddr.optional(),
  SHARE_ISSUER_FUNDER_SECRET: Secret,
  FAUCET_SECRET: Secret,
  COINVEST_SECRET: Secret,
  QUSD_ISSUER_SECRET: Secret,
  DEMO_IMPORTER_SECRET: Secret,
  RELAYER_SECRET: Secret,

  APP_DOMAIN: z.string().min(1).default('qafila.dev'),
  MIN_SECURITY_BPS: z.coerce.number().int().default(2000),
  SECURITY_STEP_BPS: z.coerce.number().int().default(250),
  SECURITY_FLOOR_BPS: z.coerce.number().int().default(1000),
  MAX_EXTENSION_SECS: z.coerce.number().int().default(600),
  COINVEST_BPS: z.coerce.number().int().default(500),
});
export type ChainEnv = z.infer<typeof ChainEnvSchema>;

let cached: ChainEnv | undefined;

/** Loads `.env` from the repo root once and returns the validated chain env. Secrets are never printed. */
export function loadChainEnv(opts: { reload?: boolean; envPath?: string } = {}): ChainEnv {
  if (cached && !opts.reload) return cached;
  const path = opts.envPath ?? resolve(repoRoot(), '.env');
  if (existsSync(path)) loadDotenv({ path, quiet: true, override: false });
  const parsed = ChainEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`invalid chain env: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

export function networkConfig(env: ChainEnv = loadChainEnv()): NetworkConfig {
  return {
    network: env.STELLAR_NETWORK,
    rpcUrl: env.STELLAR_RPC_URL,
    horizonUrl: env.HORIZON_URL,
    passphrase: env.NETWORK_PASSPHRASE,
  };
}

/** Throws a clear error naming the missing variable without revealing any value. */
export function requireEnv<K extends keyof ChainEnv>(env: ChainEnv, key: K): NonNullable<ChainEnv[K]> {
  const v = env[key];
  if (v === undefined || v === null || v === '') throw new Error(`missing ${String(key)} in .env`);
  return v as NonNullable<ChainEnv[K]>;
}
