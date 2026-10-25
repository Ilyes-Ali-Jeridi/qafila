/** Application container: env, database, adapters, chain, storage and pipeline deps, built once per process (and once per test). */
import { Keypair } from '@stellar/stellar-sdk';
import { createAdapters, type Adapters } from './adapters/index.js';
import { MemoryCache } from './adapters/base.js';
import { createChain, type Chain } from './chain/index.js';
import { createDb, type Db } from './db/index.js';
import { DbCache, DbFingerprints, getPolicy } from './db/repo.js';
import { loadDeployment, type Env } from './env.js';
import { logger } from './lib/logger.js';
import type { HalalPolicy, PipelineDeps } from './pipeline/types.js';

export interface Services {
  env: Env;
  db: Db;
  adapters: Adapters;
  chain: Chain;
  policy: () => Promise<HalalPolicy>;
  pipelineDeps: () => Promise<PipelineDeps>;
  verifierSecret: string | null;
  verifierPublicKeyHex: string | null;
  contractId: string | null;
  close: () => Promise<void>;
}

export function createServices(env: Env, opts: { db?: Db } = {}): Services {
  if (!env.DATABASE_URL && !opts.db) throw new Error('DATABASE_URL is required');
  const db = opts.db ?? createDb(env.DATABASE_URL!);
  const adapters = createAdapters(env, { cache: env.NODE_ENV === 'test' ? new MemoryCache() : new DbCache(db) });
  const chain = createChain(env);
  const dep = loadDeployment(env.STELLAR_NETWORK);
  const verifierSecret = env.VERIFIER_ED25519_SECRET ?? (chain.mode === 'mock' ? Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).secret() : null);
  const verifierPublicKeyHex = verifierSecret ? Buffer.from(Keypair.fromSecret(verifierSecret).rawPublicKey()).toString('hex') : (dep.verifierPublicKeyHex ?? null);
  const contractId = env.QAFILA_CONTRACT_ID ?? dep.contractId ?? chain.contractId;
  logger.info({ chain: chain.mode, adapters: adapters.modes, storage: adapters.storage.mode, contract: contractId }, 'services ready');
  return {
    env,
    db,
    adapters,
    chain,
    policy: () => getPolicy(db),
    pipelineDeps: async () => ({ adapters, policy: await getPolicy(db), fingerprints: new DbFingerprints(db), verifierSecret, contractId, networkPassphrase: env.NETWORK_PASSPHRASE }),
    verifierSecret,
    verifierPublicKeyHex,
    contractId,
    close: async () => {
      const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
      await client?.end?.();
    },
  };
}
