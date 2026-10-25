/**
 * One submit queue per signing key (PLAN 4.4): calls are serialised, the account
 * sequence is refreshed on every attempt, and a `txBAD_SEQ` (or any failed send)
 * is retried up to `maxAttempts` times. A venue rush of sign-ups then never trips
 * on a stale sequence number.
 */
import { Account, Keypair, type Transaction, type FeeBumpTransaction, rpc } from '@stellar/stellar-sdk';
import { waitForTx, type TxPoller } from './rpc.ts';

export interface QueueRpc extends TxPoller {
  getAccount(address: string): Promise<Account>;
  sendTransaction(tx: Transaction | FeeBumpTransaction): Promise<rpc.Api.SendTransactionResponse>;
}

export interface SubmitQueueOptions {
  rpc: QueueRpc;
  keypair: Keypair;
  maxAttempts?: number;
  /** Wait between attempts, ms (grows linearly). */
  backoffMs?: number;
  /** Poll timeout for finality, ms. */
  txTimeoutMs?: number;
  /** Poll interval for finality, ms. */
  pollIntervalMs?: number;
}

export interface SubmitResult {
  hash: string;
  ledger: number;
  attempts: number;
  response: rpc.Api.GetSuccessfulTransactionResponse;
}

export class BadSeqError extends Error {
  constructor(public readonly hash: string) {
    super(`txBAD_SEQ for ${hash}`);
    this.name = 'BadSeqError';
  }
}

export class SendError extends Error {
  constructor(
    public readonly status: string,
    public readonly hash: string,
    public readonly errorResultXdr: string | undefined,
  ) {
    super(`sendTransaction ${status} for ${hash}${errorResultXdr ? ` (${errorResultXdr})` : ''}`);
    this.name = 'SendError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isBadSeq(err: unknown): boolean {
  if (err instanceof BadSeqError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /txBAD_SEQ|tx_bad_seq|txBadSeq|bad_seq/i.test(msg);
}

function isRetryable(err: unknown): boolean {
  if (isBadSeq(err)) return true;
  if (err instanceof SendError) return err.status === 'TRY_AGAIN_LATER' || err.status === 'ERROR';
  return false;
}

export class SubmitQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;
  readonly publicKey: string;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly txTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly opts: SubmitQueueOptions) {
    this.publicKey = opts.keypair.publicKey();
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.backoffMs = opts.backoffMs ?? 500;
    this.txTimeoutMs = opts.txTimeoutMs ?? 60_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1_000;
  }

  /** Number of tasks waiting or running. */
  size(): number {
    return this.pending;
  }

  /**
   * Runs `task` after every earlier task of this key, retrying when the failure
   * looks like a sequence collision. Use this for generated-client calls
   * (`client.method(...).then(tx => tx.signAndSend())`) that fetch their own sequence.
   */
  run<T>(task: (attempt: number) => Promise<T>): Promise<T> {
    this.pending += 1;
    const next = this.chain.then(async () => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          return await task(attempt);
        } catch (err) {
          lastErr = err;
          if (!isRetryable(err) || attempt === this.maxAttempts) throw err;
          await sleep(this.backoffMs * attempt);
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    });
    this.chain = next.catch(() => undefined);
    return next.finally(() => {
      this.pending -= 1;
    });
  }

  /**
   * Builds a transaction from a freshly loaded account (new sequence each attempt),
   * signs it with this key, sends it and waits for finality.
   * `build` may be async (for example to simulate and assemble a Soroban call).
   */
  submit(
    build: (account: Account) => Transaction | Promise<Transaction>,
    extraSigners: Keypair[] = [],
  ): Promise<SubmitResult> {
    return this.run(async (attempt) => {
      const account = await this.opts.rpc.getAccount(this.publicKey);
      const tx = await build(account);
      tx.sign(this.opts.keypair, ...extraSigners);
      const sent = await this.opts.rpc.sendTransaction(tx);
      const hash = sent.hash;
      if (sent.status === 'ERROR') {
        const xdr = sent.errorResult ? sent.errorResult.toXdr('base64') : undefined;
        const code = sent.errorResult ? sent.errorResult.result.type : '';
        if (code === 'txBadSeq') throw new BadSeqError(hash);
        throw new SendError(sent.status, hash, xdr);
      }
      if (sent.status === 'TRY_AGAIN_LATER') throw new SendError(sent.status, hash, undefined);
      const response = await waitForTx(this.opts.rpc, hash, { timeoutMs: this.txTimeoutMs, intervalMs: this.pollIntervalMs });
      return { hash, ledger: response.ledger, attempts: attempt, response };
    });
  }
}

/** Process-wide registry so every module shares one queue per signing key. */
const registry = new Map<string, SubmitQueue>();

export function queueFor(rpcServer: QueueRpc, keypair: Keypair, opts: Partial<SubmitQueueOptions> = {}): SubmitQueue {
  const key = keypair.publicKey();
  let q = registry.get(key);
  if (!q) {
    q = new SubmitQueue({ rpc: rpcServer, keypair, ...opts });
    registry.set(key, q);
  }
  return q;
}

/** Test hook. */
export function resetQueues(): void {
  registry.clear();
}
