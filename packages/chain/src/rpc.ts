/** RPC helpers: server construction, transaction polling with zod, explorer links. */
import { rpc } from '@stellar/stellar-sdk';
import { z } from 'zod';
import type { NetworkConfig, NetworkName } from './env.ts';

export type RpcServer = rpc.Server;

export function makeRpc(cfg: NetworkConfig): RpcServer {
  return new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith('http://') });
}

export const TxStatusSchema = z.object({
  status: z.enum(['SUCCESS', 'NOT_FOUND', 'FAILED']),
  latestLedger: z.number().int().nonnegative(),
  ledger: z.number().int().nonnegative().optional(),
  txHash: z.string().optional(),
});

export interface WaitForTxOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/** Minimal interface so the queue and tests can use a fake. */
export interface TxPoller {
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
}

export class TxFailedError extends Error {
  constructor(
    public readonly hash: string,
    public readonly resultXdr: string | undefined,
    message = `transaction ${hash} failed`,
  ) {
    super(message);
    this.name = 'TxFailedError';
  }
}

export class TxTimeoutError extends Error {
  constructor(public readonly hash: string) {
    super(`transaction ${hash} not final after timeout`);
    this.name = 'TxTimeoutError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polls `getTransaction` until SUCCESS or FAILED (throws), or the timeout. */
export async function waitForTx(
  server: TxPoller,
  hash: string,
  opts: WaitForTxOptions = {},
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const start = Date.now();
  for (;;) {
    const res = await server.getTransaction(hash);
    const parsed = TxStatusSchema.parse({
      status: res.status,
      latestLedger: res.latestLedger,
      ledger: 'ledger' in res ? res.ledger : undefined,
      txHash: 'txHash' in res ? res.txHash : undefined,
    });
    if (parsed.status === 'SUCCESS') return res as rpc.Api.GetSuccessfulTransactionResponse;
    if (parsed.status === 'FAILED') {
      const failed = res as rpc.Api.GetFailedTransactionResponse;
      const xdr = failed.resultXdr ? failed.resultXdr.toXdr('base64') : undefined;
      throw new TxFailedError(hash, xdr);
    }
    if (Date.now() - start > timeoutMs) throw new TxTimeoutError(hash);
    await sleep(intervalMs);
  }
}

const EXPLORER: Record<NetworkName, string | null> = {
  local: null,
  testnet: 'https://stellar.expert/explorer/testnet',
  mainnet: 'https://stellar.expert/explorer/public',
};

export function explorerTxUrl(network: NetworkName, hash: string): string | null {
  const base = EXPLORER[network];
  return base ? `${base}/tx/${hash}` : null;
}

export function explorerContractUrl(network: NetworkName, id: string): string | null {
  const base = EXPLORER[network];
  return base ? `${base}/contract/${id}` : null;
}

export function explorerAccountUrl(network: NetworkName, id: string): string | null {
  const base = EXPLORER[network];
  return base ? `${base}/account/${id}` : null;
}
