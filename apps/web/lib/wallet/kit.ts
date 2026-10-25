/**
 * smart-account-kit singleton built from GET /config (PLAN 4.1). Browser only.
 * The relying party id comes from config; it is applied only when it matches the page host,
 * so a preview or localhost build never tries to create a passkey for qafila.dev.
 */
import type { PublicConfig } from '@qafila/shared';
import type { SmartAccountKit } from 'smart-account-kit';

let instance: { key: string; kit: SmartAccountKit } | null = null;

export function rpIdFor(config: PublicConfig): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = window.location.hostname;
  const rp = config.smartAccount.rpId;
  if (host === rp || host.endsWith(`.${rp}`)) return rp;
  if (process.env.NODE_ENV !== 'production') console.warn(`[wallet] rpId ${rp} does not match ${host}; using the page host`);
  return undefined;
}

export function smartAccountReady(config: PublicConfig): boolean {
  return Boolean(config.smartAccount.wasmHash && config.smartAccount.webauthnVerifier);
}

export async function getKit(config: PublicConfig): Promise<SmartAccountKit> {
  const { wasmHash, webauthnVerifier, relayerUrl } = config.smartAccount;
  if (!wasmHash || !webauthnVerifier) throw new Error('Smart accounts are not configured on this server.');
  const key = [config.rpcUrl, config.networkPassphrase, wasmHash, webauthnVerifier, relayerUrl ?? ''].join('|');
  if (instance && instance.key === key) return instance.kit;
  const mod = await import('smart-account-kit');
  const kit = new mod.SmartAccountKit({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    accountWasmHash: wasmHash,
    webauthnVerifierAddress: webauthnVerifier,
    relayerUrl: relayerUrl ?? undefined,
    rpId: rpIdFor(config),
    rpName: 'Qafila',
    storage: new mod.IndexedDBStorage(),
    timeoutInSeconds: 60,
  });
  instance = { key, kit };
  return kit;
}
