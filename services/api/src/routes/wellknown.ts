import { Hono } from 'hono';
import type { Env } from '../env.js';
import { loadDeployment } from '../env.js';

export const wellKnown = new Hono<{ Variables: { env: Env } }>();

/** Verifier key discovery (PLAN 7). */
wellKnown.get('/qafila-verifier.json', (c) => {
  const env = c.get('env');
  const dep = loadDeployment(env.STELLAR_NETWORK);
  return c.json({
    network: env.STELLAR_NETWORK,
    networkPassphrase: env.NETWORK_PASSPHRASE,
    contractId: env.QAFILA_CONTRACT_ID ?? dep.contractId ?? null,
    verifierPublicKey: dep.verifierPublicKey ?? null,
    attestation: 'sha256("QAFILA-ATTEST-V1" || u32be purpose || sha256(network passphrase) || contract address ScVal XDR || u64be deal_id || payload_hash), ed25519',
    purposes: { 1: 'LIST', 2: 'SHIPPED', 10: 'REPORT' },
    verifyOnChain: 'call verify_attestation(purpose, deal_id, payload_hash, sig) on the contract; it traps on an invalid signature',
  });
});
