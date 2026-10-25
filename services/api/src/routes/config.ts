import { Hono } from 'hono';
import { PublicConfigSchema, type PublicConfig } from '@qafila/shared';
import { flagsOf, loadDeployment, type Env } from '../env.js';
import { reply } from '../lib/http.js';

export const config = new Hono<{ Variables: { env: Env } }>();

export function publicConfig(env: Env): PublicConfig {
  const dep = loadDeployment(env.STELLAR_NETWORK);
  return {
    network: env.STELLAR_NETWORK,
    rpcUrl: env.STELLAR_RPC_URL,
    horizonUrl: env.HORIZON_URL,
    networkPassphrase: env.NETWORK_PASSPHRASE,
    contractId: env.QAFILA_CONTRACT_ID ?? dep.contractId ?? null,
    settlementToken: {
      id: env.SETTLEMENT_TOKEN_ID ?? dep.settlementToken?.id ?? null,
      code: env.SETTLEMENT_TOKEN_CODE ?? dep.settlementToken?.code ?? 'qUSD',
      issuer: env.SETTLEMENT_TOKEN_ISSUER ?? dep.settlementToken?.issuer ?? null,
      label: env.STELLAR_NETWORK === 'mainnet' ? 'USDC' : 'test dollars',
    },
    x402UsdcTokenId: env.X402_USDC_TOKEN_ID ?? null,
    charityAddress: env.CHARITY_ADDRESS ?? dep.charity ?? null,
    treasuryAddress: env.TREASURY_ADDRESS ?? dep.treasury ?? null,
    verifierPublicKey: dep.verifierPublicKey ?? null,
    smartAccount: {
      wasmHash: env.SMART_ACCOUNT_WASM_HASH ?? null,
      webauthnVerifier: env.WEBAUTHN_VERIFIER_ADDRESS ?? null,
      relayerUrl: env.RELAYER_URL ?? null,
      rpId: env.APP_DOMAIN,
    },
    entityName: env.QAFILA_ENTITY_NAME,
    coinvestBps: env.COINVEST_BPS,
    flags: flagsOf(env),
    version: process.env['npm_package_version'] ?? '0.1.0',
  };
}

config.get('/', (c) => reply(c, PublicConfigSchema, publicConfig(c.get('env'))));
