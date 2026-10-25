import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





export interface Deal {
  accepted_at: u64;
  bl_fingerprint: Option<Buffer>;
  bl_report_hash: Option<Buffer>;
  claimed_shares: i128;
  distributable: i128;
  due_at: u64;
  extended: boolean;
  funded: i128;
  holder_count: u32;
  id: u64;
  importer_at_fault: boolean;
  late_fee_due: i128;
  late_fee_paid: i128;
  listed_at: u64;
  owned_at: u64;
  paid_out: i128;
  principal_repaid: i128;
  recovered: i128;
  sale_price: i128;
  security: i128;
  state: DealState;
  supplier_paid: i128;
  terms: DealTerms;
}


export interface Owed {
  charity: i128;
  promises_held: i128;
  refunds: i128;
  treasury: i128;
}


export interface Roles {
  admin: string;
  agent: Option<string>;
  charity: string;
  next_deal_id: u64;
  paused: boolean;
  settlement: string;
  treasury: string;
  verifier: Buffer;
}


export interface Config {
  base_importer_limit: i128;
  grace_secs: u64;
  limit_step: i128;
  max_deposit_bps: u32;
  max_extension_secs: u64;
  max_investors_per_deal: u32;
  max_markup_bps: u32;
  min_security_bps: u32;
  min_tenor_secs: u64;
  security_floor_bps: u32;
  security_step_bps: u32;
}

export type DealState = {tag: "Listed", values: void} | {tag: "Funded", values: void} | {tag: "DepositPaid", values: void} | {tag: "Owned", values: void} | {tag: "Sold", values: void} | {tag: "Repaid", values: void} | {tag: "Cancelled", values: void} | {tag: "Defaulted", values: void} | {tag: "Liquidated", values: void} | {tag: "Closed", values: void};


export interface DealTerms {
  accept_window_secs: u64;
  cost: i128;
  deposit_bps: u32;
  funding_deadline: u64;
  halal_ok: boolean;
  importer: string;
  late_fee: i128;
  listing_fingerprint: Buffer;
  markup: i128;
  payment_mode: PaymentMode;
  payout_token: string;
  platform_fee: i128;
  promise_hash: Buffer;
  report_hash: Buffer;
  /**
 * Importer's security deposit (hamish jiddiyyah), locked at the promise. v1.1.
 */
security: i128;
  share_token: string;
  supplier: string;
  tenor_secs: u64;
}

export type PaymentMode = {tag: "Native", values: void} | {tag: "TrustlessWork", values: void};


export interface ImporterStats {
  defaulted: u32;
  late: u32;
  on_time: u32;
  open_exposure: i128;
  total_repaid: i128;
}


export interface PromiseRecord {
  at: u64;
  importer: string;
  listed: boolean;
  promise_hash: Buffer;
  security: i128;
}

/**
 * Error codes are public ABI. Never renumber.
 */
export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotAuthorized"},
  3: {message:"Paused"},
  4: {message:"DealNotFound"},
  5: {message:"InvalidState"},
  6: {message:"InvalidAmount"},
  7: {message:"ExceedsRemaining"},
  8: {message:"InvalidTerms"},
  9: {message:"NotApprovedInvestor"},
  10: {message:"NoPromise"},
  11: {message:"PromiseMismatch"},
  12: {message:"ListingFingerprintUsed"},
  13: {message:"BlFingerprintUsed"},
  14: {message:"ShareTokenUsed"},
  15: {message:"ShareTokenProbeFailed"},
  16: {message:"MarkupTooHigh"},
  17: {message:"FeeExceedsMarkup"},
  18: {message:"DepositTooHigh"},
  19: {message:"TenorTooShort"},
  20: {message:"NotHalal"},
  21: {message:"FundingClosed"},
  22: {message:"DeadlineNotPassed"},
  23: {message:"AcceptWindowClosed"},
  24: {message:"DueNotPassed"},
  25: {message:"TooManyInvestors"},
  26: {message:"LimitExceeded"},
  27: {message:"ImporterInDefault"},
  28: {message:"NothingToClaim"},
  29: {message:"Overflow"},
  30: {message:"SecurityTooLow"},
  31: {message:"SecurityTooHigh"},
  32: {message:"PromiseExists"},
  33: {message:"PromiseListed"},
  34: {message:"NothingToRefund"},
  35: {message:"InvalidDueDate"},
  36: {message:"AlreadyExtended"}
}

export interface Client {
  /**
   * Construct and simulate a owed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  owed: (options?: MethodOptions) => Promise<AssembledTransaction<Owed>>

  /**
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Anyone may call; it pays `holder`.
   */
  claim: ({holder, deal_id}: {holder: string, deal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pause: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a repay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  repay: ({deal_id, amount}: {deal_id: u64, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a invest transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  invest: ({investor, deal_id, amount}: {investor: string, deal_id: u64, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a holders transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Bounded page of the holder index, `limit <= 50`.
   */
  holders: ({deal_id, start, limit}: {deal_id: u64, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<string>>>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unpause: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({wasm_hash}: {wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_deal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_deal: ({deal_id}: {deal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Deal>>>

  /**
   * Construct and simulate a get_roles transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_roles: (options?: MethodOptions) => Promise<AssembledTransaction<Roles>>

  /**
   * Construct and simulate a list_deal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin lists a deal after the verifier signed the LIST attestation over `terms`.
   */
  list_deal: ({terms, sig}: {terms: DealTerms, sig: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a refund_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  refund_of: ({addr}: {addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_agent: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a abort_deal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  abort_deal: ({deal_id, importer_at_fault}: {deal_id: u64, importer_at_fault: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a close_deal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  close_deal: ({deal_id}: {deal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a extend_due transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One extension per deal, price unchanged (v1.1).
   */
  extend_due: ({deal_id, new_due_at}: {deal_id: u64, new_due_at: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Config>>

  /**
   * Construct and simulate a set_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_config: ({config}: {config: Config}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_promise transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_promise: ({listing_fingerprint}: {listing_fingerprint: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<PromiseRecord>>>

  /**
   * Construct and simulate a quote_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  quote_claim: ({holder, deal_id}: {holder: string, deal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a set_charity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_charity: ({charity}: {charity: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a mark_default transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mark_default: ({deal_id}: {deal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a pay_late_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pay_late_fee: ({deal_id, amount}: {deal_id: u64, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_treasury transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_treasury: ({treasury}: {treasury: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_verifier: ({pk}: {pk: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a sweep_charity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  sweep_charity: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a importer_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `base_importer_limit + limit_step * on_time`, 0 if the importer ever defaulted.
   */
  importer_limit: ({importer}: {importer: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a importer_stats transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  importer_stats: ({importer}: {importer: string}, options?: MethodOptions) => Promise<AssembledTransaction<ImporterStats>>

  /**
   * Construct and simulate a sweep_treasury transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  sweep_treasury: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a accept_murabaha transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_murabaha: ({deal_id}: {deal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a cancel_unfunded transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_unfunded: ({deal_id}: {deal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a revoke_investor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_investor: ({investor}: {investor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw_refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Anyone may call; it pays `addr` what is owed in refunds (v1.1).
   */
  withdraw_refund: ({addr}: {addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a approve_investor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve_investor: ({investor}: {investor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a confirm_shipment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `caller` is admin or agent. Verifies the SHIPPED attestation.
   */
  confirm_shipment: ({caller, deal_id, bl_fingerprint, bl_report_hash, sig}: {caller: string, deal_id: u64, bl_fingerprint: Buffer, bl_report_hash: Buffer, sig: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a deposit_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit_recovery: ({deal_id, from, amount}: {deal_id: u64, from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a finalize_default transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  finalize_default: ({deal_id}: {deal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a promise_purchase transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Importer's binding purchase promise (wa'd). Locks `security` (v1.1).
   */
  promise_purchase: ({importer, listing_fingerprint, promise_hash, security}: {importer: string, listing_fingerprint: Buffer, promise_hash: Buffer, security: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw_promise transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the security deposit while the promise is not yet listed (v1.1).
   */
  withdraw_promise: ({importer, listing_fingerprint}: {importer: string, listing_fingerprint: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a required_security transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `ceil(cost * max(floor, min - on_time * step) / 10000)` (v1.1).
   */
  required_security: ({importer, cost}: {importer: string, cost: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a verify_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Succeeds silently or traps on an invalid signature (PLAN 3.3.6).
   * Other contracts call this through `try_verify_attestation`.
   */
  verify_attestation: ({purpose, deal_id, payload_hash, sig}: {purpose: u32, deal_id: u64, payload_hash: Buffer, sig: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_investor_approved transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_investor_approved: ({investor}: {investor: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a pay_supplier_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `caller` is admin or agent.
   */
  pay_supplier_deposit: ({caller, deal_id}: {caller: string, deal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, verifier, charity, treasury, settlement, config}: {admin: string, verifier: Buffer, charity: string, treasury: string, settlement: string, config: Config},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, verifier, charity, treasury, settlement, config}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAEb3dlZAAAAAAAAAABAAAH0AAAAARPd2Vk",
        "AAAAAAAAACJBbnlvbmUgbWF5IGNhbGw7IGl0IHBheXMgYGhvbGRlcmAuAAAAAAAFY2xhaW0AAAAAAAACAAAAAAAAAAZob2xkZXIAAAAAABMAAAAAAAAAB2RlYWxfaWQAAAAABgAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAFcGF1c2UAAAAAAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAFcmVwYXkAAAAAAAACAAAAAAAAAAdkZWFsX2lkAAAAAAYAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAGaW52ZXN0AAAAAAADAAAAAAAAAAhpbnZlc3RvcgAAABMAAAAAAAAAB2RlYWxfaWQAAAAABgAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAADBCb3VuZGVkIHBhZ2Ugb2YgdGhlIGhvbGRlciBpbmRleCwgYGxpbWl0IDw9IDUwYC4AAAAHaG9sZGVycwAAAAADAAAAAAAAAAdkZWFsX2lkAAAAAAYAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+kAAAPqAAAAEwAAAAM=",
        "AAAAAAAAAAAAAAAHdW5wYXVzZQAAAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAIZ2V0X2RlYWwAAAABAAAAAAAAAAdkZWFsX2lkAAAAAAYAAAABAAAD6QAAB9AAAAAERGVhbAAAAAM=",
        "AAAAAAAAAAAAAAAJZ2V0X3JvbGVzAAAAAAAAAAAAAAEAAAfQAAAABVJvbGVzAAAA",
        "AAAAAAAAAE9BZG1pbiBsaXN0cyBhIGRlYWwgYWZ0ZXIgdGhlIHZlcmlmaWVyIHNpZ25lZCB0aGUgTElTVCBhdHRlc3RhdGlvbiBvdmVyIGB0ZXJtc2AuAAAAAAlsaXN0X2RlYWwAAAAAAAACAAAAAAAAAAV0ZXJtcwAAAAAAB9AAAAAJRGVhbFRlcm1zAAAAAAAAAAAAAANzaWcAAAAD7gAAAEAAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAAAAAAAAJcmVmdW5kX29mAAAAAAAAAQAAAAAAAAAEYWRkcgAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAAJc2V0X2FnZW50AAAAAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKYWJvcnRfZGVhbAAAAAAAAgAAAAAAAAAHZGVhbF9pZAAAAAAGAAAAAAAAABFpbXBvcnRlcl9hdF9mYXVsdAAAAAAAAAEAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAKY2xvc2VfZGVhbAAAAAAAAQAAAAAAAAAHZGVhbF9pZAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAC9PbmUgZXh0ZW5zaW9uIHBlciBkZWFsLCBwcmljZSB1bmNoYW5nZWQgKHYxLjEpLgAAAAAKZXh0ZW5kX2R1ZQAAAAAAAgAAAAAAAAAHZGVhbF9pZAAAAAAGAAAAAAAAAApuZXdfZHVlX2F0AAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAABkNvbmZpZwAA",
        "AAAAAAAAAAAAAAAKc2V0X2NvbmZpZwAAAAAAAQAAAAAAAAAGY29uZmlnAAAAAAfQAAAABkNvbmZpZwAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAALZ2V0X3Byb21pc2UAAAAAAQAAAAAAAAATbGlzdGluZ19maW5nZXJwcmludAAAAAPuAAAAIAAAAAEAAAPoAAAH0AAAAA1Qcm9taXNlUmVjb3JkAAAA",
        "AAAAAAAAAAAAAAALcXVvdGVfY2xhaW0AAAAAAgAAAAAAAAAGaG9sZGVyAAAAAAATAAAAAAAAAAdkZWFsX2lkAAAAAAYAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAALc2V0X2NoYXJpdHkAAAAAAQAAAAAAAAAHY2hhcml0eQAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMbWFya19kZWZhdWx0AAAAAQAAAAAAAAAHZGVhbF9pZAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMcGF5X2xhdGVfZmVlAAAAAgAAAAAAAAAHZGVhbF9pZAAAAAAGAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAMc2V0X3RyZWFzdXJ5AAAAAQAAAAAAAAAIdHJlYXN1cnkAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMc2V0X3ZlcmlmaWVyAAAAAQAAAAAAAAACcGsAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAYAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIdmVyaWZpZXIAAAPuAAAAIAAAAAAAAAAHY2hhcml0eQAAAAATAAAAAAAAAAh0cmVhc3VyeQAAABMAAAAAAAAACnNldHRsZW1lbnQAAAAAABMAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAZDb25maWcAAAAAAAA=",
        "AAAAAAAAAAAAAAANc3dlZXBfY2hhcml0eQAAAAAAAAAAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAE9gYmFzZV9pbXBvcnRlcl9saW1pdCArIGxpbWl0X3N0ZXAgKiBvbl90aW1lYCwgMCBpZiB0aGUgaW1wb3J0ZXIgZXZlciBkZWZhdWx0ZWQuAAAAAA5pbXBvcnRlcl9saW1pdAAAAAAAAQAAAAAAAAAIaW1wb3J0ZXIAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAOaW1wb3J0ZXJfc3RhdHMAAAAAAAEAAAAAAAAACGltcG9ydGVyAAAAEwAAAAEAAAfQAAAADUltcG9ydGVyU3RhdHMAAAA=",
        "AAAAAAAAAAAAAAAOc3dlZXBfdHJlYXN1cnkAAAAAAAAAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAPYWNjZXB0X211cmFiYWhhAAAAAAEAAAAAAAAAB2RlYWxfaWQAAAAABgAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAPY2FuY2VsX3VuZnVuZGVkAAAAAAEAAAAAAAAAB2RlYWxfaWQAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAPcmV2b2tlX2ludmVzdG9yAAAAAAEAAAAAAAAACGludmVzdG9yAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAD9BbnlvbmUgbWF5IGNhbGw7IGl0IHBheXMgYGFkZHJgIHdoYXQgaXMgb3dlZCBpbiByZWZ1bmRzICh2MS4xKS4AAAAAD3dpdGhkcmF3X3JlZnVuZAAAAAABAAAAAAAAAARhZGRyAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAQYXBwcm92ZV9pbnZlc3RvcgAAAAEAAAAAAAAACGludmVzdG9yAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAD1gY2FsbGVyYCBpcyBhZG1pbiBvciBhZ2VudC4gVmVyaWZpZXMgdGhlIFNISVBQRUQgYXR0ZXN0YXRpb24uAAAAAAAAEGNvbmZpcm1fc2hpcG1lbnQAAAAFAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAB2RlYWxfaWQAAAAABgAAAAAAAAAOYmxfZmluZ2VycHJpbnQAAAAAA+4AAAAgAAAAAAAAAA5ibF9yZXBvcnRfaGFzaAAAAAAD7gAAACAAAAAAAAAAA3NpZwAAAAPuAAAAQAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAQZGVwb3NpdF9yZWNvdmVyeQAAAAMAAAAAAAAAB2RlYWxfaWQAAAAABgAAAAAAAAAEZnJvbQAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAQZmluYWxpemVfZGVmYXVsdAAAAAEAAAAAAAAAB2RlYWxfaWQAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAERJbXBvcnRlcidzIGJpbmRpbmcgcHVyY2hhc2UgcHJvbWlzZSAod2EnZCkuIExvY2tzIGBzZWN1cml0eWAgKHYxLjEpLgAAABBwcm9taXNlX3B1cmNoYXNlAAAABAAAAAAAAAAIaW1wb3J0ZXIAAAATAAAAAAAAABNsaXN0aW5nX2ZpbmdlcnByaW50AAAAA+4AAAAgAAAAAAAAAAxwcm9taXNlX2hhc2gAAAPuAAAAIAAAAAAAAAAIc2VjdXJpdHkAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEhSZXR1cm5zIHRoZSBzZWN1cml0eSBkZXBvc2l0IHdoaWxlIHRoZSBwcm9taXNlIGlzIG5vdCB5ZXQgbGlzdGVkICh2MS4xKS4AAAAQd2l0aGRyYXdfcHJvbWlzZQAAAAIAAAAAAAAACGltcG9ydGVyAAAAEwAAAAAAAAATbGlzdGluZ19maW5nZXJwcmludAAAAAPuAAAAIAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAD9gY2VpbChjb3N0ICogbWF4KGZsb29yLCBtaW4gLSBvbl90aW1lICogc3RlcCkgLyAxMDAwMClgICh2MS4xKS4AAAAAEXJlcXVpcmVkX3NlY3VyaXR5AAAAAAAAAgAAAAAAAAAIaW1wb3J0ZXIAAAATAAAAAAAAAARjb3N0AAAACwAAAAEAAAAL",
        "AAAAAAAAAHxTdWNjZWVkcyBzaWxlbnRseSBvciB0cmFwcyBvbiBhbiBpbnZhbGlkIHNpZ25hdHVyZSAoUExBTiAzLjMuNikuCk90aGVyIGNvbnRyYWN0cyBjYWxsIHRoaXMgdGhyb3VnaCBgdHJ5X3ZlcmlmeV9hdHRlc3RhdGlvbmAuAAAAEnZlcmlmeV9hdHRlc3RhdGlvbgAAAAAABAAAAAAAAAAHcHVycG9zZQAAAAAEAAAAAAAAAAdkZWFsX2lkAAAAAAYAAAAAAAAADHBheWxvYWRfaGFzaAAAA+4AAAAgAAAAAAAAAANzaWcAAAAD7gAAAEAAAAAA",
        "AAAAAAAAAAAAAAAUaXNfaW52ZXN0b3JfYXBwcm92ZWQAAAABAAAAAAAAAAhpbnZlc3RvcgAAABMAAAABAAAAAQ==",
        "AAAAAAAAABtgY2FsbGVyYCBpcyBhZG1pbiBvciBhZ2VudC4AAAAAFHBheV9zdXBwbGllcl9kZXBvc2l0AAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAdkZWFsX2lkAAAAAAYAAAABAAAD6QAAAAsAAAAD",
        "AAAAAQAAAAAAAAAAAAAABERlYWwAAAAXAAAAAAAAAAthY2NlcHRlZF9hdAAAAAAGAAAAAAAAAA5ibF9maW5nZXJwcmludAAAAAAD6AAAA+4AAAAgAAAAAAAAAA5ibF9yZXBvcnRfaGFzaAAAAAAD6AAAA+4AAAAgAAAAAAAAAA5jbGFpbWVkX3NoYXJlcwAAAAAACwAAAAAAAAANZGlzdHJpYnV0YWJsZQAAAAAAAAsAAAAAAAAABmR1ZV9hdAAAAAAABgAAAAAAAAAIZXh0ZW5kZWQAAAABAAAAAAAAAAZmdW5kZWQAAAAAAAsAAAAAAAAADGhvbGRlcl9jb3VudAAAAAQAAAAAAAAAAmlkAAAAAAAGAAAAAAAAABFpbXBvcnRlcl9hdF9mYXVsdAAAAAAAAAEAAAAAAAAADGxhdGVfZmVlX2R1ZQAAAAsAAAAAAAAADWxhdGVfZmVlX3BhaWQAAAAAAAALAAAAAAAAAAlsaXN0ZWRfYXQAAAAAAAAGAAAAAAAAAAhvd25lZF9hdAAAAAYAAAAAAAAACHBhaWRfb3V0AAAACwAAAAAAAAAQcHJpbmNpcGFsX3JlcGFpZAAAAAsAAAAAAAAACXJlY292ZXJlZAAAAAAAAAsAAAAAAAAACnNhbGVfcHJpY2UAAAAAAAsAAAAAAAAACHNlY3VyaXR5AAAACwAAAAAAAAAFc3RhdGUAAAAAAAfQAAAACURlYWxTdGF0ZQAAAAAAAAAAAAANc3VwcGxpZXJfcGFpZAAAAAAAAAsAAAAAAAAABXRlcm1zAAAAAAAH0AAAAAlEZWFsVGVybXMAAAA=",
        "AAAAAQAAAAAAAAAAAAAABE93ZWQAAAAEAAAAAAAAAAdjaGFyaXR5AAAAAAsAAAAAAAAADXByb21pc2VzX2hlbGQAAAAAAAALAAAAAAAAAAdyZWZ1bmRzAAAAAAsAAAAAAAAACHRyZWFzdXJ5AAAACw==",
        "AAAAAQAAAAAAAAAAAAAABVJvbGVzAAAAAAAACAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAVhZ2VudAAAAAAAA+gAAAATAAAAAAAAAAdjaGFyaXR5AAAAABMAAAAAAAAADG5leHRfZGVhbF9pZAAAAAYAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAAAAAAKc2V0dGxlbWVudAAAAAAAEwAAAAAAAAAIdHJlYXN1cnkAAAATAAAAAAAAAAh2ZXJpZmllcgAAA+4AAAAg",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAACwAAAAAAAAATYmFzZV9pbXBvcnRlcl9saW1pdAAAAAALAAAAAAAAAApncmFjZV9zZWNzAAAAAAAGAAAAAAAAAApsaW1pdF9zdGVwAAAAAAALAAAAAAAAAA9tYXhfZGVwb3NpdF9icHMAAAAABAAAAAAAAAASbWF4X2V4dGVuc2lvbl9zZWNzAAAAAAAGAAAAAAAAABZtYXhfaW52ZXN0b3JzX3Blcl9kZWFsAAAAAAAEAAAAAAAAAA5tYXhfbWFya3VwX2JwcwAAAAAABAAAAAAAAAAQbWluX3NlY3VyaXR5X2JwcwAAAAQAAAAAAAAADm1pbl90ZW5vcl9zZWNzAAAAAAAGAAAAAAAAABJzZWN1cml0eV9mbG9vcl9icHMAAAAAAAQAAAAAAAAAEXNlY3VyaXR5X3N0ZXBfYnBzAAAAAAAABA==",
        "AAAAAgAAAAAAAAAAAAAACURlYWxTdGF0ZQAAAAAAAAoAAAAAAAAAAAAAAAZMaXN0ZWQAAAAAAAAAAAAAAAAABkZ1bmRlZAAAAAAAAAAAAAAAAAALRGVwb3NpdFBhaWQAAAAAAAAAAAAAAAAFT3duZWQAAAAAAAAAAAAAAAAAAARTb2xkAAAAAAAAAAAAAAAGUmVwYWlkAAAAAAAAAAAAAAAAAAlDYW5jZWxsZWQAAAAAAAAAAAAAAAAAAAlEZWZhdWx0ZWQAAAAAAAAAAAAAAAAAAApMaXF1aWRhdGVkAAAAAAAAAAAAAAAAAAZDbG9zZWQAAA==",
        "AAAAAQAAAAAAAAAAAAAACURlYWxUZXJtcwAAAAAAABIAAAAAAAAAEmFjY2VwdF93aW5kb3dfc2VjcwAAAAAABgAAAAAAAAAEY29zdAAAAAsAAAAAAAAAC2RlcG9zaXRfYnBzAAAAAAQAAAAAAAAAEGZ1bmRpbmdfZGVhZGxpbmUAAAAGAAAAAAAAAAhoYWxhbF9vawAAAAEAAAAAAAAACGltcG9ydGVyAAAAEwAAAAAAAAAIbGF0ZV9mZWUAAAALAAAAAAAAABNsaXN0aW5nX2ZpbmdlcnByaW50AAAAA+4AAAAgAAAAAAAAAAZtYXJrdXAAAAAAAAsAAAAAAAAADHBheW1lbnRfbW9kZQAAB9AAAAALUGF5bWVudE1vZGUAAAAAAAAAAAxwYXlvdXRfdG9rZW4AAAATAAAAAAAAAAxwbGF0Zm9ybV9mZWUAAAALAAAAAAAAAAxwcm9taXNlX2hhc2gAAAPuAAAAIAAAAAAAAAALcmVwb3J0X2hhc2gAAAAD7gAAACAAAABMSW1wb3J0ZXIncyBzZWN1cml0eSBkZXBvc2l0IChoYW1pc2ggamlkZGl5eWFoKSwgbG9ja2VkIGF0IHRoZSBwcm9taXNlLiB2MS4xLgAAAAhzZWN1cml0eQAAAAsAAAAAAAAAC3NoYXJlX3Rva2VuAAAAABMAAAAAAAAACHN1cHBsaWVyAAAAEwAAAAAAAAAKdGVub3Jfc2VjcwAAAAAABg==",
        "AAAAAgAAAAAAAAAAAAAAC1BheW1lbnRNb2RlAAAAAAIAAAAAAAAAAAAAAAZOYXRpdmUAAAAAAAAAAAAAAAAADVRydXN0bGVzc1dvcmsAAAA=",
        "AAAAAQAAAAAAAAAAAAAADUltcG9ydGVyU3RhdHMAAAAAAAAFAAAAAAAAAAlkZWZhdWx0ZWQAAAAAAAAEAAAAAAAAAARsYXRlAAAABAAAAAAAAAAHb25fdGltZQAAAAAEAAAAAAAAAA1vcGVuX2V4cG9zdXJlAAAAAAAACwAAAAAAAAAMdG90YWxfcmVwYWlkAAAACw==",
        "AAAAAQAAAAAAAAAAAAAADVByb21pc2VSZWNvcmQAAAAAAAAFAAAAAAAAAAJhdAAAAAAABgAAAAAAAAAIaW1wb3J0ZXIAAAATAAAAAAAAAAZsaXN0ZWQAAAAAAAEAAAAAAAAADHByb21pc2VfaGFzaAAAA+4AAAAgAAAAAAAAAAhzZWN1cml0eQAAAAs=",
        "AAAABAAAACtFcnJvciBjb2RlcyBhcmUgcHVibGljIEFCSS4gTmV2ZXIgcmVudW1iZXIuAAAAAAAAAAAFRXJyb3IAAAAAAAAkAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAACAAAAAAAAAAZQYXVzZWQAAAAAAAMAAAAAAAAADERlYWxOb3RGb3VuZAAAAAQAAAAAAAAADEludmFsaWRTdGF0ZQAAAAUAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAAGAAAAAAAAABBFeGNlZWRzUmVtYWluaW5nAAAABwAAAAAAAAAMSW52YWxpZFRlcm1zAAAACAAAAAAAAAATTm90QXBwcm92ZWRJbnZlc3RvcgAAAAAJAAAAAAAAAAlOb1Byb21pc2UAAAAAAAAKAAAAAAAAAA9Qcm9taXNlTWlzbWF0Y2gAAAAACwAAAAAAAAAWTGlzdGluZ0ZpbmdlcnByaW50VXNlZAAAAAAADAAAAAAAAAARQmxGaW5nZXJwcmludFVzZWQAAAAAAAANAAAAAAAAAA5TaGFyZVRva2VuVXNlZAAAAAAADgAAAAAAAAAVU2hhcmVUb2tlblByb2JlRmFpbGVkAAAAAAAADwAAAAAAAAANTWFya3VwVG9vSGlnaAAAAAAAABAAAAAAAAAAEEZlZUV4Y2VlZHNNYXJrdXAAAAARAAAAAAAAAA5EZXBvc2l0VG9vSGlnaAAAAAAAEgAAAAAAAAANVGVub3JUb29TaG9ydAAAAAAAABMAAAAAAAAACE5vdEhhbGFsAAAAFAAAAAAAAAANRnVuZGluZ0Nsb3NlZAAAAAAAABUAAAAAAAAAEURlYWRsaW5lTm90UGFzc2VkAAAAAAAAFgAAAAAAAAASQWNjZXB0V2luZG93Q2xvc2VkAAAAAAAXAAAAAAAAAAxEdWVOb3RQYXNzZWQAAAAYAAAAAAAAABBUb29NYW55SW52ZXN0b3JzAAAAGQAAAAAAAAANTGltaXRFeGNlZWRlZAAAAAAAABoAAAAAAAAAEUltcG9ydGVySW5EZWZhdWx0AAAAAAAAGwAAAAAAAAAOTm90aGluZ1RvQ2xhaW0AAAAAABwAAAAAAAAACE92ZXJmbG93AAAAHQAAAAAAAAAOU2VjdXJpdHlUb29Mb3cAAAAAAB4AAAAAAAAAD1NlY3VyaXR5VG9vSGlnaAAAAAAfAAAAAAAAAA1Qcm9taXNlRXhpc3RzAAAAAAAAIAAAAAAAAAANUHJvbWlzZUxpc3RlZAAAAAAAACEAAAAAAAAAD05vdGhpbmdUb1JlZnVuZAAAAAAiAAAAAAAAAA5JbnZhbGlkRHVlRGF0ZQAAAAAAIwAAAAAAAAAPQWxyZWFkeUV4dGVuZGVkAAAAACQ=" ]),
      options
    )
  }
  public readonly fromJSON = {
    owed: this.txFromJSON<Owed>,
        claim: this.txFromJSON<Result<i128>>,
        pause: this.txFromJSON<Result<void>>,
        repay: this.txFromJSON<Result<i128>>,
        invest: this.txFromJSON<Result<i128>>,
        holders: this.txFromJSON<Result<Array<string>>>,
        unpause: this.txFromJSON<Result<void>>,
        upgrade: this.txFromJSON<Result<void>>,
        get_deal: this.txFromJSON<Result<Deal>>,
        get_roles: this.txFromJSON<Roles>,
        list_deal: this.txFromJSON<Result<u64>>,
        refund_of: this.txFromJSON<i128>,
        set_agent: this.txFromJSON<Result<void>>,
        abort_deal: this.txFromJSON<Result<void>>,
        close_deal: this.txFromJSON<Result<void>>,
        extend_due: this.txFromJSON<Result<void>>,
        get_config: this.txFromJSON<Config>,
        set_config: this.txFromJSON<Result<void>>,
        get_promise: this.txFromJSON<Option<PromiseRecord>>,
        quote_claim: this.txFromJSON<Result<i128>>,
        set_charity: this.txFromJSON<Result<void>>,
        mark_default: this.txFromJSON<Result<void>>,
        pay_late_fee: this.txFromJSON<Result<void>>,
        set_treasury: this.txFromJSON<Result<void>>,
        set_verifier: this.txFromJSON<Result<void>>,
        sweep_charity: this.txFromJSON<Result<i128>>,
        importer_limit: this.txFromJSON<i128>,
        importer_stats: this.txFromJSON<ImporterStats>,
        sweep_treasury: this.txFromJSON<Result<i128>>,
        accept_murabaha: this.txFromJSON<Result<i128>>,
        cancel_unfunded: this.txFromJSON<Result<void>>,
        revoke_investor: this.txFromJSON<Result<void>>,
        withdraw_refund: this.txFromJSON<Result<i128>>,
        approve_investor: this.txFromJSON<Result<void>>,
        confirm_shipment: this.txFromJSON<Result<i128>>,
        deposit_recovery: this.txFromJSON<Result<void>>,
        finalize_default: this.txFromJSON<Result<void>>,
        promise_purchase: this.txFromJSON<Result<void>>,
        withdraw_promise: this.txFromJSON<Result<i128>>,
        required_security: this.txFromJSON<i128>,
        verify_attestation: this.txFromJSON<null>,
        is_investor_approved: this.txFromJSON<boolean>,
        pay_supplier_deposit: this.txFromJSON<Result<i128>>
  }
}