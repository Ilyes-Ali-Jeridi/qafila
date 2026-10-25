import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FEATURE_FLAGS, type Flags } from '@qafila/shared';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');
const opt = z.string().optional().transform((v) => (v && v.length > 0 ? v : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8787),
  STELLAR_NETWORK: z.enum(['local', 'testnet', 'mainnet']).default('testnet'),
  STELLAR_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
  NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),

  QAFILA_CONTRACT_ID: opt,
  SETTLEMENT_TOKEN_ID: opt,
  SETTLEMENT_TOKEN_CODE: z.string().default('qUSD'),
  SETTLEMENT_TOKEN_ISSUER: opt,
  QUSD_ISSUER_SECRET: opt,
  X402_USDC_TOKEN_ID: opt,
  CHARITY_ADDRESS: opt,
  TREASURY_ADDRESS: opt,
  REFLECTOR_FX_ID: opt,

  ADMIN_SECRET: opt,
  VERIFIER_ED25519_SECRET: opt,
  AGENT_SIGNER_SECRET: opt,
  AGENT_SMART_ACCOUNT_ID: opt,
  SHARE_ISSUER_FUNDER_SECRET: opt,
  FAUCET_SECRET: opt,
  COINVEST_SECRET: opt,

  SMART_ACCOUNT_WASM_HASH: opt,
  WEBAUTHN_VERIFIER_ADDRESS: opt,
  RELAYER_URL: opt,
  RELAYER_SECRET: opt,
  APP_DOMAIN: z.string().default('localhost'),

  X402_FACILITATOR_URL: opt,
  X402_FACILITATOR_API_KEY: opt,
  X402_PAYTO_ADDRESS: opt,
  X402_PRICE_USDC: z.string().default('0.50'),

  LLM_PROVIDER: z.enum(['bedrock', 'anthropic']).default('bedrock'),
  AWS_REGION: z.string().default('eu-west-1'),
  LLM_MODEL_REASON: z.string().default('qwen.qwen3-vl-235b-a22b'),
  LLM_MODEL_FAST: z.string().default('qwen.qwen3-32b-v1:0'),
  ANTHROPIC_API_KEY: opt,

  SHIPSGO_API_KEY: opt,
  OPENSANCTIONS_API_KEY: opt,
  QCC_API_KEY: opt,
  QCC_SECRET_KEY: opt,
  QCC_BASE_URL: z.string().default('https://api.qcckyc.com'),
  QCC_EKYB_PATH: z.string().default('/api/v1/cn/ekyb'),
  AISSTREAM_API_KEY: opt,
  FX_FALLBACK_URL: z.string().default('https://api.frankfurter.app'),
  ADAPTER_MODE: z.enum(['live', 'mock']).default('live'),
  SHIPSGO_MODE: z.enum(['live', 'mock']).optional(),
  OPENSANCTIONS_MODE: z.enum(['live', 'mock']).optional(),
  REGISTRY_MODE: z.enum(['live', 'mock']).optional(),
  LLM_MODE: z.enum(['live', 'mock']).optional(),
  REFLECTOR_MODE: z.enum(['live', 'mock']).optional(),
  FX_MODE: z.enum(['live', 'mock']).optional(),
  CHAIN_MODE: z.enum(['live', 'mock']).optional(),
  STORAGE_MODE: z.enum(['supabase', 'local']).default('local'),
  FIXTURES_DIR: opt,
  UPLOADS_DIR: opt,
  AGENT_DRY_RUN: bool,
  WORKER: bool,
  DEV_AUTH_BYPASS: bool,
  RESEND_FROM: opt,
  OPS_EMAIL: opt,

  TRUSTLESS_WORK_BASE_URL: opt,
  TRUSTLESS_WORK_API_KEY: opt,

  SUPABASE_URL: opt,
  SUPABASE_ANON_KEY: opt,
  SUPABASE_SERVICE_ROLE_KEY: opt,
  SUPABASE_JWT_SECRET: opt,
  DATABASE_URL: opt,
  RESEND_API_KEY: opt,
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  API_BASE_URL: z.string().default('http://localhost:8787'),
  JWT_AUDIENCE: z.string().default('qafila'),
  JWT_SECRET: opt,

  MIN_SECURITY_BPS: z.coerce.number().default(2000),
  SECURITY_STEP_BPS: z.coerce.number().default(250),
  SECURITY_FLOOR_BPS: z.coerce.number().default(1000),
  MAX_EXTENSION_SECS: z.coerce.number().default(600),
  COINVEST_BPS: z.coerce.number().default(500),
  QAFILA_ENTITY_NAME: z.string().default('Qafila Trade'),

  ...Object.fromEntries(FEATURE_FLAGS.map((f) => [f, bool])),
});

export type Env = z.infer<typeof EnvSchema> & Record<(typeof FEATURE_FLAGS)[number], boolean>;

/** deployments/<network>.json written by scripts/deploy-testnet.ts; env wins when set. */
export interface Deployment {
  contractId?: string;
  wasmHash?: string;
  verifierPublicKey?: string;
  admin?: string;
  agent?: string;
  charity?: string;
  treasury?: string;
  settlementToken?: { id: string; code: string; issuer: string };
  gitCommit?: string;
  deployedAt?: string;
}

export function loadDeployment(network: string): Deployment {
  const p = resolve(import.meta.dirname, '../../../deployments', `${network}.json`);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Deployment;
  } catch {
    return {};
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data as Env;
}

export function flagsOf(env: Env): Flags {
  return Object.fromEntries(FEATURE_FLAGS.map((f) => [f, env[f]])) as Flags;
}

export const env: Env = loadEnv();
