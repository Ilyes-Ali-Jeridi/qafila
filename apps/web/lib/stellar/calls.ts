/**
 * Typed builders for every user-signed contract call (PLAN 8.1: promise, invest, accept,
 * repay, late fee, claim, refund). Each call carries the method name, the native args (for
 * the generated client and the mock chain), the ScVal args built with the kit's SDK copy (for
 * the smart account's `execute` path) and a builder for the assembled transaction (for direct
 * signing with a G wallet). The wallet provider decides how to submit.
 */
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { Client } from '@qafila/contract-client';
import { hexToBuffer, type AssembledLike } from './client';

export type CallMethod = 'invest' | 'promise_purchase' | 'withdraw_promise' | 'accept_murabaha' | 'repay' | 'pay_late_fee' | 'claim' | 'withdraw_refund';

export interface ContractCall {
  method: CallMethod;
  /** Native args as the generated client takes them (bigint for i128/u64, Buffer for BytesN). */
  args: Record<string, unknown>;
  /** Short line shown in the confirmation sheet. */
  summary: string;
  /** ScVal args in the contract's argument order. */
  scArgs: xdr.ScVal[];
  assemble(client: Client): Promise<AssembledLike>;
}

const addr = (a: string) => new Address(a).toScVal();
const u64 = (n: bigint) => nativeToScVal(n, { type: 'u64' });
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const bytes32 = (hex: string) => xdr.ScVal.scvBytes(hexToBuffer(hex));

function make(method: CallMethod, args: Record<string, unknown>, scArgs: xdr.ScVal[], summary: string): ContractCall {
  return {
    method,
    args,
    summary,
    scArgs,
    assemble: async (client) => {
      const fn = (client as unknown as Record<string, (a: Record<string, unknown>, o?: unknown) => Promise<AssembledLike>>)[method];
      if (!fn) throw new Error(`unknown contract method ${method}`);
      return fn(args, { timeoutInSeconds: 60 });
    },
  };
}

export const calls = {
  invest: (investor: string, dealId: number, amount: bigint) => make('invest', { investor, deal_id: BigInt(dealId), amount }, [addr(investor), u64(BigInt(dealId)), i128(amount)], 'Invest in this deal'),
  promisePurchase: (importer: string, listingFingerprintHex: string, promiseHashHex: string, security: bigint) =>
    make(
      'promise_purchase',
      { importer, listing_fingerprint: hexToBuffer(listingFingerprintHex), promise_hash: hexToBuffer(promiseHashHex), security },
      [addr(importer), bytes32(listingFingerprintHex), bytes32(promiseHashHex), i128(security)],
      'Sign the purchase promise and lock the security deposit',
    ),
  withdrawPromise: (importer: string, listingFingerprintHex: string) => make('withdraw_promise', { importer, listing_fingerprint: hexToBuffer(listingFingerprintHex) }, [addr(importer), bytes32(listingFingerprintHex)], 'Withdraw the promise and get the deposit back'),
  acceptMurabaha: (dealId: number) => make('accept_murabaha', { deal_id: BigInt(dealId) }, [u64(BigInt(dealId))], 'Sign the sale at the fixed price'),
  repay: (dealId: number, amount: bigint) => make('repay', { deal_id: BigInt(dealId), amount }, [u64(BigInt(dealId)), i128(amount)], 'Repay'),
  payLateFee: (dealId: number, amount: bigint) => make('pay_late_fee', { deal_id: BigInt(dealId), amount }, [u64(BigInt(dealId)), i128(amount)], 'Pay the late fee to charity'),
  claim: (holder: string, dealId: number) => make('claim', { holder, deal_id: BigInt(dealId) }, [addr(holder), u64(BigInt(dealId))], 'Claim principal and profit'),
  withdrawRefund: (address: string) => make('withdraw_refund', { addr: address }, [addr(address)], 'Collect the refund'),
};
