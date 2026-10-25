import { describe, expect, it } from 'vitest';
import { Account, BASE_FEE, Keypair, Operation, TransactionBuilder, type Transaction, xdr, rpc } from '@stellar/stellar-sdk';
import { SubmitQueue, BadSeqError, type QueueRpc } from '../src/queue.ts';

const PASSPHRASE = 'Test SDF Network ; September 2015';

/** Fake RPC: tracks the sequence, fails with txBAD_SEQ when a stale one is used. */
class FakeRpc implements QueueRpc {
  seq = 100n;
  sends: string[] = [];
  accountLoads = 0;
  badSeqOnce = false;
  tryAgainOnce = false;
  private finals = new Map<string, number>();

  constructor(private readonly pk: string) {}

  async getAccount(address: string): Promise<Account> {
    this.accountLoads += 1;
    expect(address).toBe(this.pk);
    return new Account(address, this.seq.toString());
  }

  async sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse> {
    const hash = Buffer.from(tx.hash()).toString('hex');
    const txSeq = BigInt(tx.sequence);
    const base = { hash, latestLedger: 1, latestLedgerCloseTime: 1 };
    if (this.badSeqOnce) {
      this.badSeqOnce = false;
      // simulate a concurrent bump so the retry must reload the sequence
      this.seq += 1n;
      return {
        ...base,
        status: 'ERROR',
        errorResult: new xdr.TransactionResult({
          feeCharged: 0n,
          result: xdr.TransactionResultResult.txBadSeq(),
          ext: xdr.TransactionResultExt.v0(),
        }),
      } as rpc.Api.SendTransactionResponse;
    }
    if (this.tryAgainOnce) {
      this.tryAgainOnce = false;
      return { ...base, status: 'TRY_AGAIN_LATER' } as rpc.Api.SendTransactionResponse;
    }
    if (txSeq !== this.seq + 1n) {
      return {
        ...base,
        status: 'ERROR',
        errorResult: new xdr.TransactionResult({
          feeCharged: 0n,
          result: xdr.TransactionResultResult.txBadSeq(),
          ext: xdr.TransactionResultExt.v0(),
        }),
      } as rpc.Api.SendTransactionResponse;
    }
    this.seq = txSeq;
    this.sends.push(hash);
    this.finals.set(hash, 2);
    return { ...base, status: 'PENDING' } as rpc.Api.SendTransactionResponse;
  }

  async getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    const left = this.finals.get(hash);
    if (left === undefined) return { status: rpc.Api.GetTransactionStatus.NOT_FOUND, latestLedger: 1, latestLedgerCloseTime: 1, oldestLedger: 1, oldestLedgerCloseTime: 1, txHash: hash } as rpc.Api.GetTransactionResponse;
    if (left > 0) {
      this.finals.set(hash, left - 1);
      return { status: rpc.Api.GetTransactionStatus.NOT_FOUND, latestLedger: 1, latestLedgerCloseTime: 1, oldestLedger: 1, oldestLedgerCloseTime: 1, txHash: hash } as rpc.Api.GetTransactionResponse;
    }
    return { status: rpc.Api.GetTransactionStatus.SUCCESS, latestLedger: 5, ledger: 5, txHash: hash } as unknown as rpc.Api.GetTransactionResponse;
  }
}

function bump(account: Account): Transaction {
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
    .setTimeout(30)
    .build();
}

describe('SubmitQueue', () => {
  it('serialises submissions from one key so sequences never collide', async () => {
    const kp = Keypair.random();
    const fake = new FakeRpc(kp.publicKey());
    const q = new SubmitQueue({ rpc: fake, keypair: kp, backoffMs: 1, txTimeoutMs: 5_000, pollIntervalMs: 1 });
    const results = await Promise.all([q.submit(bump), q.submit(bump), q.submit(bump), q.submit(bump)]);
    expect(fake.sends).toHaveLength(4);
    expect(new Set(results.map((r) => r.hash)).size).toBe(4);
    expect(results.every((r) => r.attempts === 1)).toBe(true);
    expect(fake.seq).toBe(104n);
    expect(q.size()).toBe(0);
  });

  it('refreshes the sequence and retries after txBAD_SEQ', async () => {
    const kp = Keypair.random();
    const fake = new FakeRpc(kp.publicKey());
    fake.badSeqOnce = true;
    const q = new SubmitQueue({ rpc: fake, keypair: kp, backoffMs: 1, txTimeoutMs: 5_000, pollIntervalMs: 1 });
    const r = await q.submit(bump);
    expect(r.attempts).toBe(2);
    expect(fake.accountLoads).toBe(2);
    expect(fake.sends).toHaveLength(1);
  });

  it('retries TRY_AGAIN_LATER and gives up after maxAttempts', async () => {
    const kp = Keypair.random();
    const fake = new FakeRpc(kp.publicKey());
    fake.tryAgainOnce = true;
    const q = new SubmitQueue({ rpc: fake, keypair: kp, backoffMs: 1, txTimeoutMs: 5_000, pollIntervalMs: 1 });
    const r = await q.submit(bump);
    expect(r.attempts).toBe(2);

    const q2 = new SubmitQueue({ rpc: fake, keypair: kp, backoffMs: 1, maxAttempts: 2 });
    let n = 0;
    await expect(
      q2.run(async () => {
        n += 1;
        throw new BadSeqError('x');
      }),
    ).rejects.toBeInstanceOf(BadSeqError);
    expect(n).toBe(2);
  });

  it('does not retry non-sequence failures and keeps the chain alive after one', async () => {
    const kp = Keypair.random();
    const fake = new FakeRpc(kp.publicKey());
    const q = new SubmitQueue({ rpc: fake, keypair: kp, backoffMs: 1, pollIntervalMs: 1 });
    let n = 0;
    await expect(
      q.run(async () => {
        n += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(n).toBe(1);
    const r = await q.submit(bump);
    expect(r.attempts).toBe(1);
  });
});
