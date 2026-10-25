import { Keypair } from '@stellar/stellar-sdk';
import { toHex } from '@qafila/shared/attestation';
import { parseAmount } from '@qafila/shared';
import { loadDeployment, type Env } from '../env.js';
import type { Chain } from './client.js';
import { LiveChain } from './live.js';
import { MockChain } from './mock.js';

export type { Chain } from './client.js';

export function chainMode(env: Env): 'live' | 'mock' {
  if (env.CHAIN_MODE) return env.CHAIN_MODE;
  if (env.ADAPTER_MODE === 'mock') return 'mock';
  const dep = loadDeployment(env.STELLAR_NETWORK);
  return env.QAFILA_CONTRACT_ID ?? dep.contractId ? 'live' : 'mock';
}

export function createChain(env: Env): Chain {
  const dep = loadDeployment(env.STELLAR_NETWORK);
  const contractId = env.QAFILA_CONTRACT_ID ?? dep.contractId ?? null;
  const verifierHex = env.VERIFIER_ED25519_SECRET ? toHex(new Uint8Array(Keypair.fromSecret(env.VERIFIER_ED25519_SECRET).rawPublicKey())) : (dep.verifierPublicKey ?? null);
  if (chainMode(env) === 'mock' || !contractId) {
    return new MockChain({
      contractId: contractId ?? 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
      verifierPublicKeyHex: verifierHex,
      cfg: { minSecurityBps: env.MIN_SECURITY_BPS, securityStepBps: env.SECURITY_STEP_BPS, securityFloorBps: env.SECURITY_FLOOR_BPS, maxExtensionSecs: env.MAX_EXTENSION_SECS, graceSecs: 60, baseImporterLimit: parseAmount(env.BASE_IMPORTER_LIMIT), limitStep: parseAmount(env.IMPORTER_LIMIT_STEP) },
    });
  }
  return new LiveChain({ rpcUrl: env.STELLAR_RPC_URL, networkPassphrase: env.NETWORK_PASSPHRASE, contractId, adminSecret: env.ADMIN_SECRET, agentSecret: env.AGENT_SIGNER_SECRET, agentSmartAccountId: env.AGENT_SMART_ACCOUNT_ID, faucetSecret: env.FAUCET_SECRET, settlementTokenId: env.SETTLEMENT_TOKEN_ID ?? dep.settlementToken?.id });
}
