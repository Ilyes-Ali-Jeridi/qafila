/**
 * Chain access used by the API, agent and indexer. One interface, two implementations:
 *  - live: generated contract client over Stellar RPC, admin and agent keys from env,
 *    one submit queue per signing key (PLAN 4.4), @qafila/chain helpers once merged
 *  - mock: in-memory deal state so the whole API, the agent and the web app work
 *    offline (CHAIN_MODE=mock, CI, e2e with mock adapters)
 */
import type { ImporterStats, OnchainDeal, DealTerms } from '@qafila/shared';

export interface TxResult {
  txHash: string;
  ledger: number | null;
  /** Native return value when any (deal id for list_deal, amount for repay). */
  result: unknown;
  mode: 'live' | 'mock' | 'dry-run';
}

export interface ChainEvent {
  txHash: string;
  ledger: number;
  eventIndex: number;
  type: string;
  dealId: number | null;
  data: Record<string, unknown>;
  ledgerClosedAt: string | null;
  cursor: string;
}

export interface ShareTokenResult {
  sacId: string;
  issuerPublicKey: string;
  txHashes: string[];
  locked: boolean;
}

export interface Chain {
  readonly mode: 'live' | 'mock';
  readonly contractId: string | null;
  // views
  getDeal(dealId: number): Promise<OnchainDeal | null>;
  getPromise(listingFingerprintHex: string): Promise<{ importer: string; promiseHash: string; security: bigint; at: number; listed: boolean } | null>;
  requiredSecurity(importer: string, cost: bigint): Promise<bigint>;
  importerStats(importer: string): Promise<ImporterStats>;
  importerLimit(importer: string): Promise<bigint>;
  isInvestorApproved(addr: string): Promise<boolean>;
  owed(): Promise<{ charity: bigint; treasury: bigint; refunds: bigint; promisesHeld: bigint }>;
  refundOf(addr: string): Promise<bigint>;
  holders(dealId: number): Promise<string[]>;
  quoteClaim(holder: string, dealId: number): Promise<bigint>;
  verifierPublicKeyHex(): Promise<string | null>;
  // admin
  approveInvestor(addr: string): Promise<TxResult>;
  listDeal(terms: DealTerms, sig: Uint8Array): Promise<TxResult & { dealId: number }>;
  abortDeal(dealId: number, importerAtFault: boolean): Promise<TxResult>;
  markDefault(dealId: number): Promise<TxResult>;
  depositRecovery(dealId: number, from: string, amount: bigint): Promise<TxResult>;
  finalizeDefault(dealId: number): Promise<TxResult>;
  extendDue(dealId: number, newDueAt: number): Promise<TxResult>;
  // admin or agent (caller)
  paySupplierDeposit(dealId: number, as: 'admin' | 'agent', dryRun?: boolean): Promise<TxResult>;
  confirmShipment(dealId: number, blFingerprint: Uint8Array, blReportHash: Uint8Array, sig: Uint8Array, as: 'admin' | 'agent', dryRun?: boolean): Promise<TxResult>;
  // anyone
  claim(holder: string, dealId: number): Promise<TxResult>;
  closeDeal(dealId: number): Promise<TxResult>;
  sweepCharity(): Promise<TxResult>;
  sweepTreasury(): Promise<TxResult>;
  withdrawRefund(addr: string): Promise<TxResult>;
  cancelUnfunded(dealId: number): Promise<TxResult>;
  // share token factory and test money
  createShareToken(dealNumber: number): Promise<ShareTokenResult>;
  faucet(to: string, amount: bigint): Promise<TxResult>;
  dealTermsXdr(terms: DealTerms): Uint8Array;
  // events
  getEvents(cursor: string | null, startLedger: number | null): Promise<{ events: ChainEvent[]; cursor: string | null; latestLedger: number }>;
  latestLedger(): Promise<number>;
  // mock-only test helpers (no-ops live)
  simulate?: { fund(dealId: number, investor: string, amount: bigint): Promise<TxResult>; accept(dealId: number): Promise<TxResult>; repay(dealId: number, amount: bigint, late?: boolean): Promise<TxResult>; promise(importer: string, fp: string, promiseHash: string, security: bigint): Promise<TxResult> };
}
