/** In-memory chain (CHAIN_MODE=mock): follows the state machine of PLAN 3.3.4 and FLOWS 8 closely enough for the API, agent, indexer and web app to run offline. */
import { createHash, randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { DealTerms, ImporterStats, OnchainDeal } from '@qafila/shared';
import { requiredSecurity } from '@qafila/shared';
import { canonicalJson, toHex } from '@qafila/shared/attestation';
import type { Chain, ChainEvent, ShareTokenResult, TxResult } from './client.js';

const fakeHash = (seed: string): string => createHash('sha256').update(`${seed}:${Date.now()}:${randomBytes(4).toString('hex')}`).digest('hex');

export interface MockChainOptions {
  contractId: string;
  verifierPublicKeyHex: string | null;
  cfg: { minSecurityBps: number; securityStepBps: number; securityFloorBps: number; maxExtensionSecs: number; graceSecs: number; baseImporterLimit: bigint; limitStep: bigint };
}

export class MockChain implements Chain {
  readonly mode = 'mock' as const;
  readonly contractId: string;
  private nextId = 1;
  private ledger = 1000;
  private readonly deals = new Map<number, OnchainDeal>();
  private readonly promises = new Map<string, { importer: string; promiseHash: string; security: bigint; at: number; listed: boolean }>();
  private readonly investors = new Set<string>();
  private readonly stats = new Map<string, ImporterStats>();
  private readonly refunds = new Map<string, bigint>();
  private readonly holdersOf = new Map<number, Map<string, bigint>>();
  private readonly events: ChainEvent[] = [];
  private charityOwed = 0n;
  private treasuryOwed = 0n;

  constructor(private readonly opts: MockChainOptions) {
    this.contractId = opts.contractId;
  }

  private now(): number {
    return Math.floor(Date.now() / 1000);
  }
  private tx(type: string, dealId: number | null, data: Record<string, unknown>, result: unknown = null): TxResult {
    const txHash = fakeHash(type);
    this.ledger += 1;
    this.events.push({ txHash, ledger: this.ledger, eventIndex: 0, type, dealId, data: JSON.parse(canonicalJson(data)) as Record<string, unknown>, ledgerClosedAt: new Date().toISOString(), cursor: `${this.ledger}-0` });
    return { txHash, ledger: this.ledger, result, mode: 'mock' };
  }
  private deal(id: number): OnchainDeal {
    const d = this.deals.get(id);
    if (!d) throw new Error('DealNotFound');
    return d;
  }
  private statsOf(importer: string): ImporterStats {
    return this.stats.get(importer) ?? { on_time: 0, late: 0, defaulted: 0, total_repaid: '0', open_exposure: '0' };
  }
  private setStats(importer: string, s: ImporterStats): void {
    this.stats.set(importer, s);
  }
  private refund(importer: string, amount: bigint, dealId: number): void {
    if (amount <= 0n) return;
    this.refunds.set(importer, (this.refunds.get(importer) ?? 0n) + amount);
    this.events.push({ txHash: fakeHash('refund_owed'), ledger: this.ledger, eventIndex: 1, type: 'refund_owed', dealId, data: { importer, amount: amount.toString() }, ledgerClosedAt: new Date().toISOString(), cursor: `${this.ledger}-1` });
  }

  async getDeal(dealId: number): Promise<OnchainDeal | null> {
    return this.deals.get(dealId) ?? null;
  }
  async getPromise(fp: string) {
    return this.promises.get(fp) ?? null;
  }
  async requiredSecurity(importer: string, cost: bigint): Promise<bigint> {
    return requiredSecurity(cost, this.statsOf(importer).on_time, this.opts.cfg);
  }
  async importerStats(importer: string): Promise<ImporterStats> {
    return this.statsOf(importer);
  }
  async importerLimit(importer: string): Promise<bigint> {
    const s = this.statsOf(importer);
    if (s.defaulted > 0) return 0n;
    return this.opts.cfg.baseImporterLimit + this.opts.cfg.limitStep * BigInt(s.on_time);
  }
  async isInvestorApproved(addr: string): Promise<boolean> {
    return this.investors.has(addr);
  }
  async owed() {
    let held = 0n;
    for (const p of this.promises.values()) if (!p.listed) held += p.security;
    let refunds = 0n;
    for (const r of this.refunds.values()) refunds += r;
    return { charity: this.charityOwed, treasury: this.treasuryOwed, refunds, promisesHeld: held };
  }
  async refundOf(addr: string): Promise<bigint> {
    return this.refunds.get(addr) ?? 0n;
  }
  async holders(dealId: number): Promise<string[]> {
    return [...(this.holdersOf.get(dealId)?.keys() ?? [])];
  }
  async quoteClaim(holder: string, dealId: number): Promise<bigint> {
    const d = this.deal(dealId);
    const shares = this.holdersOf.get(dealId)?.get(holder) ?? 0n;
    if (shares === 0n || BigInt(d.funded) === 0n) return 0n;
    return (shares * BigInt(d.distributable)) / BigInt(d.funded);
  }
  async verifierPublicKeyHex(): Promise<string | null> {
    return this.opts.verifierPublicKeyHex;
  }

  async approveInvestor(addr: string): Promise<TxResult> {
    this.investors.add(addr);
    return this.tx('investor_approved', null, { investor: addr });
  }
  async listDeal(terms: DealTerms, _sig: Uint8Array): Promise<TxResult & { dealId: number }> {
    const p = this.promises.get(terms.listing_fingerprint);
    if (!p) throw new Error('NoPromise');
    if (p.importer !== terms.importer || p.promiseHash !== terms.promise_hash) throw new Error('PromiseMismatch');
    if (p.listed) throw new Error('ListingFingerprintUsed');
    if (BigInt(terms.security) !== p.security) throw new Error('PromiseMismatch');
    if (!terms.halal_ok) throw new Error('NotHalal');
    if (BigInt(terms.platform_fee) > BigInt(terms.markup)) throw new Error('FeeExceedsMarkup');
    const id = this.nextId++;
    const now = this.now();
    const deal: OnchainDeal = { id, terms, state: 'Listed', listed_at: now, funded: '0', supplier_paid: '0', owned_at: 0, bl_fingerprint: null, bl_report_hash: null, sale_price: '0', accepted_at: 0, due_at: 0, principal_repaid: '0', late_fee_due: '0', late_fee_paid: '0', recovered: '0', distributable: '0', claimed_shares: '0', paid_out: '0', holder_count: 0, security: terms.security, importer_at_fault: false, extended: false };
    this.deals.set(id, deal);
    p.listed = true;
    const s = this.statsOf(terms.importer);
    this.setStats(terms.importer, { ...s, open_exposure: (BigInt(s.open_exposure) + BigInt(terms.cost)).toString() });
    const r = this.tx('deal_listed', id, { importer: terms.importer, cost: terms.cost, security: terms.security, listing_fingerprint: terms.listing_fingerprint }, id);
    return { ...r, dealId: id };
  }
  async abortDeal(dealId: number, importerAtFault: boolean): Promise<TxResult> {
    const d = this.deal(dealId);
    const s = this.statsOf(d.terms.importer);
    if (d.state === 'Listed' || d.state === 'Funded') {
      d.state = 'Cancelled';
      d.distributable = d.funded;
      this.refund(d.terms.importer, BigInt(d.security), dealId);
      d.security = '0';
      this.setStats(d.terms.importer, { ...s, open_exposure: (BigInt(s.open_exposure) - BigInt(d.terms.cost)).toString() });
    } else if (d.state === 'DepositPaid' || d.state === 'Owned') {
      d.state = 'Defaulted';
      d.importer_at_fault = importerAtFault;
      if (importerAtFault) this.setStats(d.terms.importer, { ...s, defaulted: s.defaulted + 1 });
      else {
        this.refund(d.terms.importer, BigInt(d.security), dealId);
        d.security = '0';
      }
    } else throw new Error('InvalidState');
    return this.tx('aborted', dealId, { importer_at_fault: importerAtFault, state: d.state });
  }
  async markDefault(dealId: number): Promise<TxResult> {
    const d = this.deal(dealId);
    if (d.state !== 'Sold') throw new Error('InvalidState');
    if (this.now() <= d.due_at + this.opts.cfg.graceSecs) throw new Error('DueNotPassed');
    d.state = 'Defaulted';
    const s = this.statsOf(d.terms.importer);
    this.setStats(d.terms.importer, { ...s, defaulted: s.defaulted + 1 });
    return this.tx('defaulted', dealId, {});
  }
  async depositRecovery(dealId: number, from: string, amount: bigint): Promise<TxResult> {
    const d = this.deal(dealId);
    if (d.state !== 'Defaulted') throw new Error('InvalidState');
    if (BigInt(d.sale_price) > 0n && BigInt(d.principal_repaid) + BigInt(d.recovered) + amount > BigInt(d.sale_price)) throw new Error('ExceedsRemaining');
    d.recovered = (BigInt(d.recovered) + amount).toString();
    return this.tx('recovery', dealId, { from, amount: amount.toString() });
  }
  async finalizeDefault(dealId: number): Promise<TxResult> {
    const d = this.deal(dealId);
    if (d.state !== 'Defaulted') throw new Error('InvalidState');
    const balance = BigInt(d.funded) - BigInt(d.supplier_paid) + BigInt(d.principal_repaid) + BigInt(d.recovered);
    let used = 0n;
    if (BigInt(d.sale_price) === 0n && BigInt(d.security) > 0n) {
      const loss = BigInt(d.funded) - balance > 0n ? BigInt(d.funded) - balance : 0n;
      used = loss < BigInt(d.security) ? loss : BigInt(d.security);
      this.refund(d.terms.importer, BigInt(d.security) - used, dealId);
      d.security = '0';
    }
    d.distributable = (balance + used).toString();
    d.state = 'Liquidated';
    const s = this.statsOf(d.terms.importer);
    this.setStats(d.terms.importer, { ...s, open_exposure: (BigInt(s.open_exposure) - BigInt(d.terms.cost)).toString() });
    return this.tx('liquidated', dealId, { security_used: used.toString(), distributable: d.distributable });
  }
  async extendDue(dealId: number, newDueAt: number): Promise<TxResult> {
    const d = this.deal(dealId);
    if (d.state !== 'Sold') throw new Error('InvalidState');
    if (d.extended) throw new Error('AlreadyExtended');
    if (newDueAt <= d.due_at || newDueAt > d.due_at + this.opts.cfg.maxExtensionSecs) throw new Error('InvalidDueDate');
    d.due_at = newDueAt;
    d.extended = true;
    return this.tx('due_extended', dealId, { due_at: newDueAt });
  }
  async paySupplierDeposit(dealId: number, as: 'admin' | 'agent', dryRun = false): Promise<TxResult> {
    const d = this.deal(dealId);
    if (d.state !== 'Funded') throw new Error('InvalidState');
    const deposit = (BigInt(d.terms.cost) * BigInt(d.terms.deposit_bps)) / 10000n;
    if (dryRun) return { txHash: '', ledger: null, result: deposit.toString(), mode: 'dry-run' };
    d.supplier_paid = deposit.toString();
    d.state = 'DepositPaid';
    return this.tx('deposit_paid', dealId, { caller: as, amount: deposit.toString() }, deposit.toString());
  }
  async confirmShipment(dealId: number, blFingerprint: Uint8Array, blReportHash: Uint8Array, _sig: Uint8Array, as: 'admin' | 'agent', dryRun = false): Promise<TxResult> {
    const d = this.deal(dealId);
    if (d.state !== 'DepositPaid') throw new Error('InvalidState');
    const fp = toHex(blFingerprint);
    for (const other of this.deals.values()) if (other.bl_fingerprint === fp) throw new Error('BlFingerprintUsed');
    const balance = BigInt(d.terms.cost) - BigInt(d.supplier_paid);
    if (dryRun) return { txHash: '', ledger: null, result: balance.toString(), mode: 'dry-run' };
    d.supplier_paid = d.terms.cost;
    d.bl_fingerprint = fp;
    d.bl_report_hash = toHex(blReportHash);
    d.owned_at = this.now();
    d.state = 'Owned';
    return this.tx('shipment_confirmed', dealId, { caller: as, balance: balance.toString(), bl_fingerprint: fp }, balance.toString());
  }
  async claim(holder: string, dealId: number): Promise<TxResult> {
    const d = this.deal(dealId);
    if (!['Repaid', 'Cancelled', 'Liquidated'].includes(d.state)) throw new Error('InvalidState');
    const h = this.holdersOf.get(dealId);
    const shares = h?.get(holder) ?? 0n;
    if (shares === 0n) throw new Error('NothingToClaim');
    const payout = (shares * BigInt(d.distributable)) / BigInt(d.funded);
    h!.delete(holder);
    d.claimed_shares = (BigInt(d.claimed_shares) + shares).toString();
    d.paid_out = (BigInt(d.paid_out) + payout).toString();
    return this.tx('claimed', dealId, { holder, shares: shares.toString(), payout: payout.toString() }, payout.toString());
  }
  async closeDeal(dealId: number): Promise<TxResult> {
    const d = this.deal(dealId);
    if (!['Repaid', 'Cancelled', 'Liquidated'].includes(d.state) || BigInt(d.claimed_shares) !== BigInt(d.funded)) throw new Error('InvalidState');
    const dust = BigInt(d.distributable) - BigInt(d.paid_out);
    this.charityOwed += dust;
    d.state = 'Closed';
    return this.tx('closed', dealId, { dust: dust.toString() });
  }
  async sweepCharity(): Promise<TxResult> {
    const amt = this.charityOwed;
    this.charityOwed = 0n;
    return this.tx('swept', null, { to: 'charity', amount: amt.toString() }, amt.toString());
  }
  async sweepTreasury(): Promise<TxResult> {
    const amt = this.treasuryOwed;
    this.treasuryOwed = 0n;
    return this.tx('swept', null, { to: 'treasury', amount: amt.toString() }, amt.toString());
  }
  async withdrawRefund(addr: string): Promise<TxResult> {
    const amt = this.refunds.get(addr) ?? 0n;
    if (amt === 0n) throw new Error('NothingToRefund');
    this.refunds.delete(addr);
    return this.tx('refunded', null, { addr, amount: amt.toString() }, amt.toString());
  }
  async cancelUnfunded(dealId: number): Promise<TxResult> {
    const d = this.deal(dealId);
    if (d.state !== 'Listed') throw new Error('InvalidState');
    if (this.now() <= d.terms.funding_deadline) throw new Error('DeadlineNotPassed');
    d.state = 'Cancelled';
    d.distributable = d.funded;
    this.refund(d.terms.importer, BigInt(d.security), dealId);
    d.security = '0';
    return this.tx('cancelled', dealId, {});
  }
  async createShareToken(dealNumber: number): Promise<ShareTokenResult> {
    const issuer = Keypair.random().publicKey();
    const sacId = `C${createHash('sha256').update(`share:${dealNumber}:${issuer}`).digest('hex').slice(0, 10).toUpperCase().replace(/[^A-Z2-7]/g, 'A').padEnd(55, 'A')}`;
    return { sacId: sacId.slice(0, 56), issuerPublicKey: issuer, txHashes: [fakeHash('factory')], locked: true };
  }
  async faucet(to: string, amount: bigint): Promise<TxResult> {
    return this.tx('faucet', null, { to, amount: amount.toString() });
  }
  dealTermsXdr(terms: DealTerms): Uint8Array {
    return new TextEncoder().encode(canonicalJson(terms));
  }
  async getEvents(cursor: string | null, _startLedger: number | null) {
    const after = cursor ? Number(cursor.split('-')[0]) : 0;
    const evs = this.events.filter((e) => e.ledger > after || (cursor !== null && e.ledger === after && e.eventIndex > Number(cursor.split('-')[1] ?? -1)));
    const last = evs[evs.length - 1];
    return { events: evs, cursor: last ? last.cursor : cursor, latestLedger: this.ledger };
  }
  async latestLedger(): Promise<number> {
    return this.ledger;
  }

  readonly simulate = {
    promise: async (importer: string, fp: string, promiseHash: string, security: bigint): Promise<TxResult> => {
      if (this.promises.get(fp)?.listed) throw new Error('PromiseListed');
      if (this.statsOf(importer).defaulted > 0) throw new Error('ImporterInDefault');
      this.promises.set(fp, { importer, promiseHash, security, at: this.now(), listed: false });
      return this.tx('promised', null, { importer, listing_fingerprint: fp, security: security.toString() });
    },
    fund: async (dealId: number, investor: string, amount: bigint): Promise<TxResult> => {
      const d = this.deal(dealId);
      if (d.state !== 'Listed') throw new Error('InvalidState');
      if (!this.investors.has(investor)) throw new Error('NotApprovedInvestor');
      const remaining = BigInt(d.terms.cost) - BigInt(d.funded);
      if (amount <= 0n || amount > remaining) throw new Error('ExceedsRemaining');
      const h = this.holdersOf.get(dealId) ?? new Map<string, bigint>();
      h.set(investor, (h.get(investor) ?? 0n) + amount);
      this.holdersOf.set(dealId, h);
      d.holder_count = h.size;
      d.funded = (BigInt(d.funded) + amount).toString();
      const r = this.tx('invested', dealId, { investor, amount: amount.toString() }, amount.toString());
      if (BigInt(d.funded) === BigInt(d.terms.cost)) {
        d.state = 'Funded';
        this.tx('funded', dealId, { funded: d.funded });
      }
      return r;
    },
    accept: async (dealId: number): Promise<TxResult> => {
      const d = this.deal(dealId);
      if (d.state !== 'Owned') throw new Error('InvalidState');
      d.sale_price = (BigInt(d.terms.cost) + BigInt(d.terms.markup)).toString();
      d.accepted_at = this.now();
      d.due_at = d.accepted_at + d.terms.tenor_secs;
      d.principal_repaid = d.security;
      d.security = '0';
      d.state = 'Sold';
      this.tx('security_applied', dealId, { amount: d.principal_repaid });
      return this.tx('murabaha_accepted', dealId, { sale_price: d.sale_price, due_at: d.due_at });
    },
    repay: async (dealId: number, amount: bigint, late = false): Promise<TxResult> => {
      const d = this.deal(dealId);
      if (d.state !== 'Sold') throw new Error('InvalidState');
      const remaining = BigInt(d.sale_price) - BigInt(d.principal_repaid);
      if (amount <= 0n || amount > remaining) throw new Error('ExceedsRemaining');
      d.principal_repaid = (BigInt(d.principal_repaid) + amount).toString();
      if (BigInt(d.principal_repaid) === BigInt(d.sale_price)) {
        const s = this.statsOf(d.terms.importer);
        const isLate = late || this.now() > d.due_at;
        if (isLate) d.late_fee_due = d.terms.late_fee;
        this.treasuryOwed += BigInt(d.terms.platform_fee);
        d.distributable = (BigInt(d.sale_price) - BigInt(d.terms.platform_fee)).toString();
        this.setStats(d.terms.importer, { ...s, on_time: s.on_time + (isLate || d.extended ? 0 : 1), late: s.late + (isLate ? 1 : 0), total_repaid: (BigInt(s.total_repaid) + BigInt(d.sale_price)).toString(), open_exposure: (BigInt(s.open_exposure) - BigInt(d.terms.cost)).toString() });
        d.state = 'Repaid';
      }
      return this.tx('repaid', dealId, { amount: amount.toString(), principal_repaid: d.principal_repaid, state: d.state }, amount.toString());
    },
  };
}
