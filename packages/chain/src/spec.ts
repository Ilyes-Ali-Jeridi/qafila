/**
 * The Qafila contract spec, taken from the generated client so every encoding
 * (DealTerms XDR for the LIST attestation, result decoding) uses the same source.
 */
import { Client } from '@qafila/contract-client';
import { Spec } from '@stellar/stellar-sdk/contract';

/** Any syntactically valid contract id; the spec does not depend on it. */
const PLACEHOLDER_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

let cached: Spec | undefined;

export function qafilaSpec(): Spec {
  if (cached) return cached;
  const client = new Client({
    contractId: PLACEHOLDER_CONTRACT,
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
  });
  cached = client.spec;
  return cached;
}
