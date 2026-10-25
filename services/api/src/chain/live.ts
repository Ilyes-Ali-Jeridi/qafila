/**
 * Live chain access through the generated bindings (packages/contract-client) and
 * Stellar RPC. Views are simulated; admin writes are signed by ADMIN_SECRET; agent
 * writes by AGENT_SIGNER_SECRET (a plain G agent key, the SP6 fallback; the smart
 * account path lands with @qafila/chain). Every write goes through the submit queue of
 * its signing key. The share-token factory and the DealTerms XDR helper come from
 * @qafila/chain once Track A merges it; until then the factory throws (TODO).
 */
import { Keypair, Networks, rpc as StellarRpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { basicNodeSigner, type AssembledTransaction } from '@stellar/stellar-sdk/contract';
import { Client as QafilaClient, type DealTerms as ClientDealTerms } from '@qafila/contract-client';
import type { DealTerms, ImporterStats, OnchainDeal } from '@qafila/shared';
import { fromHex, toHex } from '@qafila/shared/attestation';
import { logger } from '../lib/logger.js';
import type { Chain, ChainEvent, ShareTokenResult, TxResult } from './client.js';
import { submitQueue } from './submit.js';

export interface LiveChainOptions {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  adminSecret?: string;
  agentSecret?: string;
  agentSmartAccountId?: string;
  faucetSecret?: string;
  settlementTokenId?: string;
}

const log = logger.child({ module: 'chain' });

const DUMMY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
type Unwrap<T> = T extends { unwrap: () => infer U } ? U : T;

export class LiveChain implements Chain {
  readonly mode = 'live' as const;
  readonly contractId: string;
  private readonly server: StellarRpc.Server;
  private readonly admin: Keypair | null;
  private readonly agent: Keypair | null;

  constructor(private readonly o: LiveChainOptions) {
    this.contractId = o.contractId;
    this.server = new StellarRpc.Server(o.rpcUrl, { allowHttp: o.rpcUrl.startsWith('http://') });
    this.admin = o.adminSecret ? Keypair.fromSecret(o.adminSecret) : null;
    this.agent = o.agentSecret ? Keypair.fromSecret(o.agentSecret) : null;
  }

  private client(signer?: Keypair): QafilaClient {
    const base = { contractId: this.contractId, networkPassphrase: this.o.networkPassphrase, rpcUrl: this.o.rpcUrl, allowHttp: this.o.rpcUrl.startsWith('http://') };
    if (!signer) return new QafilaClient({ ...base, publicKey: DUMMY });
    const s = basicNodeSigner(signer, this.o.networkPassphrase);
    return new QafilaClient({ ...base, publicKey: signer.publicKey(), signTransaction: s.signTransaction, signAuthEntry: s.signAuthEntry });
  }

  private async view<T>(fn: (c: QafilaClient) => Promise<AssembledTransaction<T>>): Promise<Unwrap<T>> {
    const tx = await fn(this.client());
    const r = tx.result as unknown;
    if (r && typeof r === 'object' && 'unwrap' in (r as object)) return (r as { unwrap: () => Unwrap<T> }).unwrap();
    return r as Unwrap<T>;
  }

  private async send<T>(key: Keypair, label: string, fn: (c: QafilaClient) => Promise<AssembledTransaction<T>>): Promise<TxResult & { value: Unwrap<T> | null }> {
    return submitQueue.run(key.publicKey(), async () => {
      const tx = await fn(this.client(key));
      const sent = await tx.signAndSend();
      const hash = sent.sendTransactionResponse?.hash ?? '';
      const ledger = sent.getTransactionResponse && 'ledger' in sent.getTransactionResponse ? (sent.getTransactionResponse as { ledger: number }).ledger : null;
      let value: Unwrap<T> | null = null;
      try {
        const r = sent.result as unknown;
        value = r && typeof r === 'object' && 'unwrap' in (r as object) ? (r as { unwrap: () => Unwrap<T> }).unwrap() : (r as Unwrap<T>);
      } catch (e) {
        log.warn({ label, err: (e as Error).message }, 'result unwrap failed');
      }
      log.info({ label, hash, ledger }, 'tx sent');
      return { txHash: hash, ledger, result: value, mode: 'live' as const, value };
    });
  }

  private requireAdmin(): Keypair {
    if (!this.admin) throw new Error('ADMIN_SECRET missing');
    return this.admin;
  }
  private signerFor(as: 'admin' | 'agent'): { key: Keypair; caller: string } {
    if (as === 'agent') {
      if (!this.agent) throw new Error('AGENT_SIGNER_SECRET missing');
      // Smart account path (SP6): the caller is the smart account and the agent key signs its auth entry; TODO wire through @qafila/chain.
      return { key: this.agent, caller: this.o.agentSmartAccountId ?? this.agent.publicKey() };
    }
    const k = this.requireAdmin();
    return { key: k, caller: k.publicKey() };
  }

  private toTerms(t: DealTerms): ClientDealTerms {
    return {
      importer: t.importer,
      supplier: t.supplier,
      share_token: t.share_token,
      payout_token: t.payout_token,
      cost: BigInt(t.cost),
      deposit_bps: t.deposit_bps,
      markup: BigInt(t.markup),
      platform_fee: BigInt(t.platform_fee),
      late_fee: BigInt(t.late_fee),
      funding_deadline: BigInt(t.funding_deadline),
      accept_window_secs: BigInt(t.accept_window_secs),
      tenor_secs: BigInt(t.tenor_secs),
      listing_fingerprint: Buffer.from(fromHex(t.listing_fingerprint)),
      report_hash: Buffer.from(fromHex(t.report_hash)),
      promise_hash: Buffer.from(fromHex(t.promise_hash)),
      halal_ok: t.halal_ok,
      payment_mode: { tag: t.payment_mode, values: undefined } as ClientDealTerms['payment_mode'],
      security: BigInt(t.security),
    };
  }

  private fromDeal(d: Record<string, unknown>): OnchainDeal {
    const t = d['terms'] as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'bigint' ? v.toString() : String(v));
    const n = (v: unknown) => Number(v);
    const hex = (v: unknown) => (v ? toHex(new Uint8Array(v as Buffer)) : null);
    return {
      id: n(d['id']),
      terms: {
        importer: String(t['importer']),
        supplier: String(t['supplier']),
        share_token: String(t['share_token']),
        payout_token: String(t['payout_token']),
        cost: s(t['cost']),
        deposit_bps: n(t['deposit_bps']),
        markup: s(t['markup']),
        platform_fee: s(t['platform_fee']),
        late_fee: s(t['late_fee']),
        funding_deadline: n(t['funding_deadline']),
        accept_window_secs: n(t['accept_window_secs']),
        tenor_secs: n(t['tenor_secs']),
        listing_fingerprint: hex(t['listing_fingerprint']) ?? '',
        report_hash: hex(t['report_hash']) ?? '',
        promise_hash: hex(t['promise_hash']) ?? '',
        halal_ok: Boolean(t['halal_ok']),
        payment_mode: ((t['payment_mode'] as { tag?: string })?.tag ?? 'Native') as 'Native' | 'TrustlessWork',
        security: s(t['security']),
      },
      state: ((d['state'] as { tag?: string })?.tag ?? 'Listed') as OnchainDeal['state'],
      listed_at: n(d['listed_at']),
      funded: s(d['funded']),
      supplier_paid: s(d['supplier_paid']),
      owned_at: n(d['owned_at']),
      bl_fingerprint: hex(d['bl_fingerprint']),
      bl_report_hash: hex(d['bl_report_hash']),
      sale_price: s(d['sale_price']),
      accepted_at: n(d['accepted_at']),
      due_at: n(d['due_at']),
      principal_repaid: s(d['principal_repaid']),
      late_fee_due: s(d['late_fee_due']),
      late_fee_paid: s(d['late_fee_paid']),
      recovered: s(d['recovered']),
      distributable: s(d['distributable']),
      claimed_shares: s(d['claimed_shares']),
      paid_out: s(d['paid_out']),
      holder_count: n(d['holder_count']),
      security: s(d['security']),
      importer_at_fault: Boolean(d['importer_at_fault']),
      extended: Boolean(d['extended']),
    };
  }

  async getDeal(dealId: number): Promise<OnchainDeal | null> {
    try {
      const d = await this.view((c) => c.get_deal({ deal_id: BigInt(dealId) }));
      return d ? this.fromDeal(d as unknown as Record<string, unknown>) : null;
    } catch (e) {
      if (/DealNotFound|#4\b/.test((e as Error).message)) return null;
      throw e;
    }
  }
  async getPromise(fp: string) {
    const p = (await this.view((c) => c.get_promise({ listing_fingerprint: Buffer.from(fromHex(fp)) }))) as { importer: string; promise_hash: Buffer; security: bigint; at: bigint; listed: boolean } | undefined;
    return p ? { importer: p.importer, promiseHash: toHex(new Uint8Array(p.promise_hash)), security: BigInt(p.security), at: Number(p.at), listed: p.listed } : null;
  }
  async requiredSecurity(importer: string, cost: bigint): Promise<bigint> {
    return BigInt(await this.view((c) => c.required_security({ importer, cost })));
  }
  async importerStats(importer: string): Promise<ImporterStats> {
    const s = (await this.view((c) => c.importer_stats({ importer }))) as { on_time: number; late: number; defaulted: number; total_repaid: bigint; open_exposure: bigint };
    return { on_time: Number(s.on_time), late: Number(s.late), defaulted: Number(s.defaulted), total_repaid: s.total_repaid.toString(), open_exposure: s.open_exposure.toString() };
  }
  async importerLimit(importer: string): Promise<bigint> {
    return BigInt(await this.view((c) => c.importer_limit({ importer })));
  }
  async isInvestorApproved(addr: string): Promise<boolean> {
    return Boolean(await this.view((c) => c.is_investor_approved({ investor: addr })));
  }
  async owed() {
    const o = (await this.view((c) => c.owed())) as { charity: bigint; treasury: bigint; refunds: bigint; promises_held: bigint };
    return { charity: BigInt(o.charity), treasury: BigInt(o.treasury), refunds: BigInt(o.refunds), promisesHeld: BigInt(o.promises_held) };
  }
  async refundOf(addr: string): Promise<bigint> {
    return BigInt(await this.view((c) => c.refund_of({ addr })));
  }
  async holders(dealId: number): Promise<string[]> {
    const out: string[] = [];
    for (let start = 0; start < 10_000; start += 50) {
      const page = (await this.view((c) => c.holders({ deal_id: BigInt(dealId), start, limit: 50 }))) as string[];
      out.push(...page);
      if (page.length < 50) break;
    }
    return out;
  }
  async quoteClaim(holder: string, dealId: number): Promise<bigint> {
    return BigInt(await this.view((c) => c.quote_claim({ holder, deal_id: BigInt(dealId) })));
  }
  async verifierPublicKeyHex(): Promise<string | null> {
    const r = (await this.view((c) => c.get_roles())) as { verifier: Buffer };
    return r?.verifier ? toHex(new Uint8Array(r.verifier)) : null;
  }

  async approveInvestor(addr: string): Promise<TxResult> {
    return this.send(this.requireAdmin(), 'approve_investor', (c) => c.approve_investor({ investor: addr }));
  }
  async listDeal(terms: DealTerms, sig: Uint8Array): Promise<TxResult & { dealId: number }> {
    const r = await this.send(this.requireAdmin(), 'list_deal', (c) => c.list_deal({ terms: this.toTerms(terms), sig: Buffer.from(sig) }));
    return { ...r, dealId: Number(r.value ?? 0) };
  }
  async abortDeal(dealId: number, importerAtFault: boolean): Promise<TxResult> {
    return this.send(this.requireAdmin(), 'abort_deal', (c) => c.abort_deal({ deal_id: BigInt(dealId), importer_at_fault: importerAtFault }));
  }
  async markDefault(dealId: number): Promise<TxResult> {
    return this.send(this.requireAdmin(), 'mark_default', (c) => c.mark_default({ deal_id: BigInt(dealId) }));
  }
  async depositRecovery(dealId: number, from: string, amount: bigint): Promise<TxResult> {
    return this.send(this.requireAdmin(), 'deposit_recovery', (c) => c.deposit_recovery({ deal_id: BigInt(dealId), from, amount }));
  }
  async finalizeDefault(dealId: number): Promise<TxResult> {
    return this.send(this.requireAdmin(), 'finalize_default', (c) => c.finalize_default({ deal_id: BigInt(dealId) }));
  }
  async extendDue(dealId: number, newDueAt: number): Promise<TxResult> {
    return this.send(this.requireAdmin(), 'extend_due', (c) => c.extend_due({ deal_id: BigInt(dealId), new_due_at: BigInt(newDueAt) }));
  }
  async paySupplierDeposit(dealId: number, as: 'admin' | 'agent', dryRun = false): Promise<TxResult> {
    const { key, caller } = this.signerFor(as);
    if (dryRun) {
      const tx = await this.client(key).pay_supplier_deposit({ caller, deal_id: BigInt(dealId) });
      return { txHash: '', ledger: null, result: String(tx.result), mode: 'dry-run' };
    }
    return this.send(key, 'pay_supplier_deposit', (c) => c.pay_supplier_deposit({ caller, deal_id: BigInt(dealId) }));
  }
  async confirmShipment(dealId: number, blFingerprint: Uint8Array, blReportHash: Uint8Array, sig: Uint8Array, as: 'admin' | 'agent', dryRun = false): Promise<TxResult> {
    const { key, caller } = this.signerFor(as);
    const args = { caller, deal_id: BigInt(dealId), bl_fingerprint: Buffer.from(blFingerprint), bl_report_hash: Buffer.from(blReportHash), sig: Buffer.from(sig) };
    if (dryRun) {
      const tx = await this.client(key).confirm_shipment(args);
      return { txHash: '', ledger: null, result: String(tx.result), mode: 'dry-run' };
    }
    return this.send(key, 'confirm_shipment', (c) => c.confirm_shipment(args));
  }
  async claim(holder: string, dealId: number): Promise<TxResult> {
    return this.send(this.anyKey(), 'claim', (c) => c.claim({ holder, deal_id: BigInt(dealId) }));
  }
  async closeDeal(dealId: number): Promise<TxResult> {
    return this.send(this.anyKey(), 'close_deal', (c) => c.close_deal({ deal_id: BigInt(dealId) }));
  }
  async sweepCharity(): Promise<TxResult> {
    return this.send(this.anyKey(), 'sweep_charity', (c) => c.sweep_charity());
  }
  async sweepTreasury(): Promise<TxResult> {
    return this.send(this.anyKey(), 'sweep_treasury', (c) => c.sweep_treasury());
  }
  async withdrawRefund(addr: string): Promise<TxResult> {
    return this.send(this.anyKey(), 'withdraw_refund', (c) => c.withdraw_refund({ addr }));
  }
  async cancelUnfunded(dealId: number): Promise<TxResult> {
    return this.send(this.anyKey(), 'cancel_unfunded', (c) => c.cancel_unfunded({ deal_id: BigInt(dealId) }));
  }
  private anyKey(): Keypair {
    const k = this.agent ?? this.admin;
    if (!k) throw new Error('no signing key for open calls');
    return k;
  }

  async createShareToken(_dealNumber: number): Promise<ShareTokenResult> {
    // TODO(@qafila/chain): share-token factory (PLAN 3.1) from Track A. Until merged this throws so listing fails loudly in live mode.
    throw new Error('share-token factory not available yet: merge @qafila/chain (track/chain) and wire createShareToken');
  }
  async faucet(to: string, amount: bigint): Promise<TxResult> {
    // TODO(@qafila/chain): qUSD mint/transfer from the faucet account through the SAC client. Until then throws so the route reports 503.
    void to;
    void amount;
    throw new Error('faucet not wired: needs @qafila/chain SAC helper and FAUCET_SECRET');
  }
  dealTermsXdr(terms: DealTerms): Uint8Array {
    const c = this.client();
    const scv = c.spec.funcArgsToScVals('list_deal', { terms: this.toTerms(terms), sig: Buffer.alloc(64) })[0];
    if (!scv) throw new Error('terms encoding failed');
    return new Uint8Array(scv.toXDR());
  }
  async getEvents(cursor: string | null, startLedger: number | null) {
    const filters = [{ type: 'contract' as const, contractIds: [this.contractId] }];
    const res = cursor ? await this.server.getEvents({ filters, cursor, limit: 100 }) : await this.server.getEvents({ filters, startLedger: startLedger ?? Math.max(1, (await this.latestLedger()) - 17_000), limit: 100 });
    const events: ChainEvent[] = res.events.map((e, i) => {
      const topics = e.topic.map((t) => {
        try {
          return scValToNative(t) as unknown;
        } catch {
          return t.toXDR('base64');
        }
      });
      let value: unknown = null;
      try {
        value = scValToNative(e.value);
      } catch {
        value = e.value.toXDR('base64');
      }
      const type = typeof topics[0] === 'string' ? topics[0] : String(topics[0] ?? 'unknown');
      const dealTopic = topics.find((t, idx) => idx > 0 && (typeof t === 'bigint' || typeof t === 'number'));
      const data = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
      const dealFromData = data['deal_id'] ?? data['id'];
      const dealId = dealTopic !== undefined ? Number(dealTopic) : dealFromData !== undefined ? Number(dealFromData) : null;
      return { txHash: e.txHash, ledger: e.ledger, eventIndex: i, type, dealId: Number.isFinite(dealId as number) ? (dealId as number) : null, data: JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Buffer || v instanceof Uint8Array ? toHex(new Uint8Array(v)) : v))) as Record<string, unknown>, ledgerClosedAt: e.ledgerClosedAt ?? null, cursor: e.id ?? `${e.ledger}-${i}` };
    });
    return { events, cursor: res.cursor ?? (events[events.length - 1]?.cursor ?? cursor), latestLedger: res.latestLedger };
  }
  async latestLedger(): Promise<number> {
    return (await this.server.getLatestLedger()).sequence;
  }
}

export const networkPassphraseFor = (n: 'local' | 'testnet' | 'mainnet'): string => (n === 'mainnet' ? Networks.PUBLIC : n === 'testnet' ? Networks.TESTNET : 'Standalone Network ; February 2017');
export { xdr };
