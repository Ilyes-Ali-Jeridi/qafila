/**
 * Live chain access through @qafila/chain (Track A) and the generated bindings. Views
 * are simulated; admin writes are signed by ADMIN_SECRET and agent writes by
 * AGENT_SIGNER_SECRET (the plain G agent key, the SP6 fallback; the smart-account
 * signing recipe in contracts/spikes/results/sp6.md is the next step). Every write goes
 * through the submit queue of its signing key. The share-token factory, the qUSD faucet
 * and the DealTerms XDR come from @qafila/chain.
 */
import { Keypair, rpc as StellarRpc, scValToNative } from '@stellar/stellar-sdk';
import type { AssembledTransaction } from '@stellar/stellar-sdk/contract';
import { Client as QafilaClient, type DealTerms as ClientDealTerms } from '@qafila/contract-client';
import { ChainEnvSchema, call, createShareToken, encodeDealTerms, faucetSend, makeClient, qusdContext, readOnlyClient, view, type ChainEnv, type NetworkConfig, type SignedClient } from '@qafila/chain';
import type { DealTerms, ImporterStats, OnchainDeal } from '@qafila/shared';
import { fromHex, toHex } from '@qafila/shared/attestation';
import { logger } from '../lib/logger.js';
import type { Chain, ChainEvent, ShareTokenResult, TxResult } from './client.js';

export interface LiveChainOptions {
  rpcUrl: string;
  horizonUrl: string;
  network: 'local' | 'testnet' | 'mainnet';
  networkPassphrase: string;
  contractId: string;
  adminSecret?: string;
  agentSecret?: string;
  agentSmartAccountId?: string;
  appDomain: string;
  processEnv: NodeJS.ProcessEnv;
}

const log = logger.child({ module: 'chain' });

export class LiveChain implements Chain {
  readonly mode = 'live' as const;
  readonly contractId: string;
  private readonly server: StellarRpc.Server;
  private readonly cfg: NetworkConfig;
  private readonly chainEnv: ChainEnv;
  private readonly readClient: QafilaClient;
  private adminSigned: SignedClient | null = null;
  private agentSigned: SignedClient | null = null;

  constructor(private readonly o: LiveChainOptions) {
    this.contractId = o.contractId;
    this.server = new StellarRpc.Server(o.rpcUrl, { allowHttp: o.rpcUrl.startsWith('http://') });
    this.cfg = { network: o.network, rpcUrl: o.rpcUrl, horizonUrl: o.horizonUrl, passphrase: o.networkPassphrase };
    this.chainEnv = ChainEnvSchema.parse({ ...o.processEnv, QAFILA_CONTRACT_ID: o.contractId });
    this.readClient = readOnlyClient(o.contractId, this.cfg);
  }

  private admin(): SignedClient {
    if (!this.o.adminSecret) throw new Error('ADMIN_SECRET missing');
    this.adminSigned ??= makeClient({ contractId: this.contractId, cfg: this.cfg, keypair: Keypair.fromSecret(this.o.adminSecret) });
    return this.adminSigned;
  }
  private agent(): SignedClient {
    if (!this.o.agentSecret) throw new Error('AGENT_SIGNER_SECRET missing');
    this.agentSigned ??= makeClient({ contractId: this.contractId, cfg: this.cfg, keypair: Keypair.fromSecret(this.o.agentSecret) });
    return this.agentSigned;
  }
  private signerFor(as: 'admin' | 'agent'): { signed: SignedClient; caller: string } {
    if (as === 'agent') {
      const signed = this.agent();
      // The on-chain agent role is the plain G key until the API signs as the smart account (sp6.md).
      return { signed, caller: signed.keypair.publicKey() };
    }
    const signed = this.admin();
    return { signed, caller: signed.keypair.publicKey() };
  }
  private anySigner(): SignedClient {
    return this.o.agentSecret ? this.agent() : this.admin();
  }

  private async send<T>(signed: SignedClient, label: string, build: (c: QafilaClient) => Promise<AssembledTransaction<T>>): Promise<TxResult & { value: unknown }> {
    const out = await call(signed, build);
    log.info({ label, hash: out.hash }, 'tx sent');
    return { txHash: out.hash ?? '', ledger: null, result: out.result, mode: 'live', value: out.result };
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
      const d = await view(await this.readClient.get_deal({ deal_id: BigInt(dealId) }));
      return d ? this.fromDeal(d as unknown as Record<string, unknown>) : null;
    } catch (e) {
      if (/DealNotFound|#4\b/.test((e as Error).message)) return null;
      throw e;
    }
  }
  async getPromise(fp: string) {
    const p = (await view(await this.readClient.get_promise({ listing_fingerprint: Buffer.from(fromHex(fp)) }))) as { importer: string; promise_hash: Buffer; security: bigint; at: bigint; listed: boolean } | undefined;
    return p ? { importer: p.importer, promiseHash: toHex(new Uint8Array(p.promise_hash)), security: BigInt(p.security), at: Number(p.at), listed: p.listed } : null;
  }
  async requiredSecurity(importer: string, cost: bigint): Promise<bigint> {
    return BigInt(await view(await this.readClient.required_security({ importer, cost })));
  }
  async importerStats(importer: string): Promise<ImporterStats> {
    const s = (await view(await this.readClient.importer_stats({ importer }))) as { on_time: number; late: number; defaulted: number; total_repaid: bigint; open_exposure: bigint };
    return { on_time: Number(s.on_time), late: Number(s.late), defaulted: Number(s.defaulted), total_repaid: s.total_repaid.toString(), open_exposure: s.open_exposure.toString() };
  }
  async importerLimit(importer: string): Promise<bigint> {
    return BigInt(await view(await this.readClient.importer_limit({ importer })));
  }
  async isInvestorApproved(addr: string): Promise<boolean> {
    return Boolean(await view(await this.readClient.is_investor_approved({ investor: addr })));
  }
  async owed() {
    const o = (await view(await this.readClient.owed())) as { charity: bigint; treasury: bigint; refunds: bigint; promises_held: bigint };
    return { charity: BigInt(o.charity), treasury: BigInt(o.treasury), refunds: BigInt(o.refunds), promisesHeld: BigInt(o.promises_held) };
  }
  async refundOf(addr: string): Promise<bigint> {
    return BigInt(await view(await this.readClient.refund_of({ addr })));
  }
  async holders(dealId: number): Promise<string[]> {
    const out: string[] = [];
    for (let start = 0; start < 10_000; start += 50) {
      const page = (await view(await this.readClient.holders({ deal_id: BigInt(dealId), start, limit: 50 }))) as string[];
      out.push(...page);
      if (page.length < 50) break;
    }
    return out;
  }
  async quoteClaim(holder: string, dealId: number): Promise<bigint> {
    return BigInt(await view(await this.readClient.quote_claim({ holder, deal_id: BigInt(dealId) })));
  }
  async verifierPublicKeyHex(): Promise<string | null> {
    const r = (await view(await this.readClient.get_roles())) as { verifier: Buffer };
    return r?.verifier ? toHex(new Uint8Array(r.verifier)) : null;
  }

  async approveInvestor(addr: string): Promise<TxResult> {
    return this.send(this.admin(), 'approve_investor', (c) => c.approve_investor({ investor: addr }));
  }
  async listDeal(terms: DealTerms, sig: Uint8Array): Promise<TxResult & { dealId: number }> {
    const r = await this.send(this.admin(), 'list_deal', (c) => c.list_deal({ terms: this.toTerms(terms), sig: Buffer.from(sig) }));
    return { ...r, dealId: Number(r.value ?? 0) };
  }
  async abortDeal(dealId: number, importerAtFault: boolean): Promise<TxResult> {
    return this.send(this.admin(), 'abort_deal', (c) => c.abort_deal({ deal_id: BigInt(dealId), importer_at_fault: importerAtFault }));
  }
  async markDefault(dealId: number): Promise<TxResult> {
    return this.send(this.admin(), 'mark_default', (c) => c.mark_default({ deal_id: BigInt(dealId) }));
  }
  async depositRecovery(dealId: number, from: string, amount: bigint): Promise<TxResult> {
    return this.send(this.admin(), 'deposit_recovery', (c) => c.deposit_recovery({ deal_id: BigInt(dealId), from, amount }));
  }
  async finalizeDefault(dealId: number): Promise<TxResult> {
    return this.send(this.admin(), 'finalize_default', (c) => c.finalize_default({ deal_id: BigInt(dealId) }));
  }
  async extendDue(dealId: number, newDueAt: number): Promise<TxResult> {
    return this.send(this.admin(), 'extend_due', (c) => c.extend_due({ deal_id: BigInt(dealId), new_due_at: BigInt(newDueAt) }));
  }
  async paySupplierDeposit(dealId: number, as: 'admin' | 'agent', dryRun = false): Promise<TxResult> {
    const { signed, caller } = this.signerFor(as);
    if (dryRun) {
      const tx = await signed.client.pay_supplier_deposit({ caller, deal_id: BigInt(dealId) });
      return { txHash: '', ledger: null, result: String(await view(tx)), mode: 'dry-run' };
    }
    return this.send(signed, 'pay_supplier_deposit', (c) => c.pay_supplier_deposit({ caller, deal_id: BigInt(dealId) }));
  }
  async confirmShipment(dealId: number, blFingerprint: Uint8Array, blReportHash: Uint8Array, sig: Uint8Array, as: 'admin' | 'agent', dryRun = false): Promise<TxResult> {
    const { signed, caller } = this.signerFor(as);
    const args = { caller, deal_id: BigInt(dealId), bl_fingerprint: Buffer.from(blFingerprint), bl_report_hash: Buffer.from(blReportHash), sig: Buffer.from(sig) };
    if (dryRun) {
      const tx = await signed.client.confirm_shipment(args);
      return { txHash: '', ledger: null, result: String(await view(tx)), mode: 'dry-run' };
    }
    return this.send(signed, 'confirm_shipment', (c) => c.confirm_shipment(args));
  }
  async claim(holder: string, dealId: number): Promise<TxResult> {
    return this.send(this.anySigner(), 'claim', (c) => c.claim({ holder, deal_id: BigInt(dealId) }));
  }
  async closeDeal(dealId: number): Promise<TxResult> {
    return this.send(this.anySigner(), 'close_deal', (c) => c.close_deal({ deal_id: BigInt(dealId) }));
  }
  async sweepCharity(): Promise<TxResult> {
    return this.send(this.anySigner(), 'sweep_charity', (c) => c.sweep_charity());
  }
  async sweepTreasury(): Promise<TxResult> {
    return this.send(this.anySigner(), 'sweep_treasury', (c) => c.sweep_treasury());
  }
  async withdrawRefund(addr: string): Promise<TxResult> {
    return this.send(this.anySigner(), 'withdraw_refund', (c) => c.withdraw_refund({ addr }));
  }
  async cancelUnfunded(dealId: number): Promise<TxResult> {
    return this.send(this.anySigner(), 'cancel_unfunded', (c) => c.cancel_unfunded({ deal_id: BigInt(dealId) }));
  }

  async createShareToken(dealNumber: number): Promise<ShareTokenResult> {
    const r = await createShareToken({ dealNumber, adminContractId: this.contractId, env: this.chainEnv, cfg: this.cfg, rpc: this.server, homeDomain: this.o.appDomain, onStep: (step, detail) => log.info({ step, detail }, 'share token factory') });
    return { sacId: r.sacId, issuerPublicKey: r.issuer, txHashes: Object.values(r.txs).filter((h): h is string => typeof h === 'string' && h.length > 0), locked: Boolean(r.verified) };
  }
  async faucet(to: string, amount: bigint): Promise<TxResult> {
    const r = await faucetSend({ to, amount }, qusdContext(this.chainEnv));
    return { txHash: r.hash, ledger: r.ledger, result: amount.toString(), mode: 'live' };
  }
  dealTermsXdr(terms: DealTerms): Uint8Array {
    return encodeDealTerms(this.toTerms(terms));
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
