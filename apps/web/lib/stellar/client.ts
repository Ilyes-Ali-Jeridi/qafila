/**
 * Generated contract client (packages/contract-client, stellar-sdk 17) bound to the runtime
 * config. Never a hard-coded contract id: callers pass the PublicConfig from GET /config.
 *
 * Note on SDK copies: smart-account-kit 0.8.0 needs stellar-sdk 16 (its XDR accessors changed
 * in 17), so the web app pins 16.4.1 for the kit and for hand-built ScVals, while the generated
 * client carries its own 17.4.0. Nothing xdr-typed crosses between the two: the kit gets ScVals
 * built with 16, the generated client is used for simulation (views) and for G-wallet signing.
 */
import { Client } from '@qafila/contract-client';
import type { PublicConfig } from '@qafila/shared';

export interface ClientSigner {
  publicKey: string;
  signTransaction?: (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
}

/** The parts of an AssembledTransaction the wallet layer relies on, independent of the SDK copy. */
export interface AssembledLike {
  result: unknown;
  signAndSend(opts?: { force?: boolean }): Promise<{ sendTransactionResponse?: { hash: string }; getTransactionResponse?: { txHash?: string } }>;
}

export function makeQafilaClient(config: PublicConfig, signer?: ClientSigner): Client {
  if (!config.contractId) throw new Error('The Qafila contract is not deployed on this network yet.');
  return new Client({
    contractId: config.contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    allowHttp: config.rpcUrl.startsWith('http://'),
    publicKey: signer?.publicKey,
    signTransaction: signer?.signTransaction,
  });
}

/** Unwrap a `Result<T>` from the generated client (Ok/Err objects) or pass a plain value through. */
export function unwrap<T>(r: unknown): T {
  const obj = r as { isOk?: () => boolean; unwrap?: () => T; unwrapErr?: () => { message: string } };
  if (obj && typeof obj.isOk === 'function' && typeof obj.unwrap === 'function') {
    if (obj.isOk()) return obj.unwrap();
    const err = obj.unwrapErr?.();
    throw new Error(err?.message ?? 'contract call failed');
  }
  return r as T;
}

export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}
