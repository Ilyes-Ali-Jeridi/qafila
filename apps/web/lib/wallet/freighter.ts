/**
 * Freighter and other G-address wallets through Stellar Wallets Kit (PLAN 4.2).
 * Static v2 API; initialised once per network.
 */
import type { PublicConfig } from '@qafila/shared';

let initialised: string | null = null;

async function ensure(config: PublicConfig) {
  const { StellarWalletsKit, Networks } = await import('@creit.tech/stellar-wallets-kit');
  const { defaultModules } = await import('@creit.tech/stellar-wallets-kit/modules/utils');
  const network = config.network === 'mainnet' ? Networks.PUBLIC : config.network === 'local' ? Networks.STANDALONE : Networks.TESTNET;
  if (initialised !== network) {
    StellarWalletsKit.init({ modules: defaultModules(), network });
    initialised = network;
  }
  return StellarWalletsKit;
}

export async function connectExternalWallet(config: PublicConfig): Promise<string> {
  const kit = await ensure(config);
  const { address } = await kit.authModal();
  return address;
}

export async function disconnectExternalWallet(config: PublicConfig) {
  const kit = await ensure(config);
  await kit.disconnect().catch(() => undefined);
}

/** signTransaction in the shape the generated contract client expects. */
export async function externalSignTransaction(config: PublicConfig, xdr: string, opts?: { networkPassphrase?: string; address?: string }) {
  const kit = await ensure(config);
  const r = await kit.signTransaction(xdr, { networkPassphrase: opts?.networkPassphrase ?? config.networkPassphrase, address: opts?.address });
  return { signedTxXdr: r.signedTxXdr, signerAddress: r.signerAddress };
}
