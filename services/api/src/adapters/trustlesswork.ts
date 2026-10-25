/**
 * Trustless Work escrow adapter (PLAN 10.1, S2, `FF_TRUSTLESS_WORK`). V1 multi-release REST API:
 * every write is build (unsigned XDR) -> sign with the role's G key -> `POST /helper/send-transaction`.
 *
 * SP10 findings (docs/SPIKES-s2.md, Sun 25 Oct 18:10 to 18:30 WET, testnet):
 *  - the API deploys escrows in any classic asset (`trustline` = issuer + code; qUSD worked), but it
 *    refuses to build unless every role wallet holds a Circle USDC trustline, whatever the asset;
 *  - a plain SAC transfer to the escrow contract address funds it (no `fund-escrow` call needed), so
 *    the deal contract's `pay_supplier_deposit` / `confirm_shipment` fund it unchanged;
 *  - the agent G key alone approves and releases a milestone (no service-provider status step);
 *  - the protocol fee is 0.3% of each payout, paid to a Trustless Work address the API fills in. That
 *    address holds USDC only, so release and resolve through the API fail for any other asset (the
 *    API answers "Escrow not found"). The adapter surfaces this as `blocked_asset`.
 *
 * Live mode needs TRUSTLESS_WORK_API_KEY; mock mode keeps escrows in memory with the same
 * preconditions the contract enforces, and labels every call as a mock in the logs.
 */
import { createHash } from 'node:crypto';
import { Keypair, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { HttpError, retryOnTransient, withRetry } from '../lib/retry.js';
import type { AdapterMode } from './base.js';

export const TRUSTLESS_WORK_TESTNET = 'https://dev.api.trustlesswork.com';
export const TRUSTLESS_WORK_MAINNET = 'https://api.trustlesswork.com';
export const TRUSTLESS_WORK_VIEWER = 'https://viewer.trustlesswork.com';
/** Protocol fee observed in SP10 on testnet (0.3% of every payout). */
export const DEFAULT_PROTOCOL_FEE_BPS = 30;
const SEVEN = 10_000_000n;

// ------------------------------------------------------------------ fee math (pure, tested)

/** Smallest `gross` such that `gross - floor(gross * feeBps / 10000) >= amount`: what to fund so the receiver nets `amount`. */
export function grossUp(amount: bigint, feeBps: number): bigint {
  if (amount <= 0n) return 0n;
  if (feeBps <= 0) return amount;
  const d = 10000n - BigInt(feeBps);
  let gross = (amount * 10000n + d - 1n) / d;
  while (netOfFee(gross, feeBps) < amount) gross += 1n;
  while (gross > amount && netOfFee(gross - 1n, feeBps) >= amount) gross -= 1n;
  return gross;
}

/** What the receiver gets from a payout of `amount` (the contract floors the fee). */
export function netOfFee(amount: bigint, feeBps: number): bigint {
  return amount - (amount * BigInt(feeBps)) / 10000n;
}

export interface EscrowPlan {
  /** On-chain `terms.cost`: the invoice cost grossed up so the supplier nets the invoice after the fee. */
  grossCost: bigint;
  /** Milestone 1 = the contract's deposit transfer (`grossCost * depositBps / 10000`, floored like the contract). */
  deposit: bigint;
  /** Milestone 2 = the contract's balance transfer (`grossCost - deposit`). */
  balance: bigint;
  /** The escrow cost of the deal, disclosed to investors. */
  fee: bigint;
  feeBps: number;
  invoiceCost: bigint;
  /** What the supplier receives across both milestones after the protocol fee. */
  supplierNet: bigint;
}

export function escrowPlan(invoiceCost: bigint, depositBps: number, feeBps: number): EscrowPlan {
  const grossCost = grossUp(invoiceCost, feeBps);
  const deposit = (grossCost * BigInt(depositBps)) / 10000n;
  const balance = grossCost - deposit;
  return { grossCost, deposit, balance, fee: grossCost - invoiceCost, feeBps, invoiceCost, supplierNet: netOfFee(deposit, feeBps) + netOfFee(balance, feeBps) };
}

/** The API takes token amounts as JS numbers with 7 decimals. */
export function stroopsToApiAmount(stroops: bigint): number {
  return Number(stroops) / Number(SEVEN);
}
export function apiAmountToStroops(amount: number): bigint {
  return BigInt(Math.round(amount * Number(SEVEN)));
}

// ------------------------------------------------------------------ types and schemas

export interface EscrowRoles {
  approver: string;
  serviceProvider: string;
  platformAddress: string;
  releaseSigner: string;
  disputeResolver: string;
}

export interface DeployEscrowInput {
  signer: Keypair;
  engagementId: string;
  title: string;
  description: string;
  roles: EscrowRoles;
  milestones: Array<{ description: string; amount: bigint; receiver: string }>;
  /** Classic asset the escrow holds: issuer G address and code (the API resolves the SAC). */
  asset: { issuer: string; code: string };
}

export interface EscrowTx {
  txHash: string;
  mode: AdapterMode;
}

export interface EscrowMilestoneState {
  index: number;
  description: string;
  amount: bigint;
  receiver: string | null;
  status: string;
  approved: boolean;
  released: boolean;
  disputed: boolean;
  resolved: boolean;
}

export interface EscrowState {
  contractId: string;
  engagementId: string;
  type: string;
  roles: EscrowRoles;
  trustline: { issuer: string | null; contractId: string | null; symbol: string | null };
  milestones: EscrowMilestoneState[];
  balance: bigint | null;
  platformFee: number;
}

export type TrustlessWorkErrorCode = 'blocked_asset' | 'api' | 'validation' | 'not_found' | 'precondition';

export class TrustlessWorkError extends Error {
  constructor(
    public readonly code: TrustlessWorkErrorCode,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'TrustlessWorkError';
  }
}

const BuildResponse = z.object({ status: z.string().optional(), unsignedTransaction: z.string().min(1) });
const SendResponse = z.object({ status: z.string().optional(), message: z.string().optional(), contractId: z.string().optional() }).passthrough();
const ApiErrorBody = z.object({ statusCode: z.number().optional(), message: z.union([z.string(), z.array(z.string())]).optional() }).passthrough();
const FlagsSchema = z.object({ approved: z.boolean().optional(), released: z.boolean().optional(), disputed: z.boolean().optional(), resolved: z.boolean().optional() }).partial();
export const EscrowRecordSchema = z
  .object({
    contractId: z.string(),
    engagementId: z.string().default(''),
    type: z.string().default('multi-release'),
    platformFee: z.number().default(0),
    roles: z.object({ approver: z.string(), serviceProvider: z.string(), platformAddress: z.string(), releaseSigner: z.string(), disputeResolver: z.string() }).passthrough(),
    trustline: z.object({ address: z.string().optional(), contractId: z.string().optional(), symbol: z.string().optional() }).partial().optional(),
    milestones: z.array(z.object({ description: z.string().default(''), amount: z.number(), status: z.string().default('pending'), receiver: z.string().optional(), flags: FlagsSchema.optional() }).passthrough()),
    balance: z.number().optional(),
  })
  .passthrough();
export type EscrowRecord = z.infer<typeof EscrowRecordSchema>;

export function toEscrowState(r: EscrowRecord): EscrowState {
  return {
    contractId: r.contractId,
    engagementId: r.engagementId,
    type: r.type,
    roles: { approver: r.roles.approver, serviceProvider: r.roles.serviceProvider, platformAddress: r.roles.platformAddress, releaseSigner: r.roles.releaseSigner, disputeResolver: r.roles.disputeResolver },
    trustline: { issuer: r.trustline?.address ?? null, contractId: r.trustline?.contractId ?? null, symbol: r.trustline?.symbol ?? null },
    milestones: r.milestones.map((m, index) => ({ index, description: m.description, amount: apiAmountToStroops(m.amount), receiver: m.receiver ?? null, status: m.status, approved: Boolean(m.flags?.approved), released: Boolean(m.flags?.released), disputed: Boolean(m.flags?.disputed), resolved: Boolean(m.flags?.resolved) })),
    balance: r.balance === undefined ? null : apiAmountToStroops(r.balance),
    platformFee: r.platformFee,
  };
}

export interface TrustlessWorkClient {
  readonly mode: AdapterMode;
  readonly feeBps: number;
  deploy(input: DeployEscrowInput): Promise<{ escrowId: string; txHash: string; mode: AdapterMode }>;
  approveMilestone(escrowId: string, index: number, approver: Keypair): Promise<EscrowTx>;
  releaseMilestone(escrowId: string, index: number, releaseSigner: Keypair): Promise<EscrowTx>;
  disputeMilestone(escrowId: string, index: number, signer: Keypair): Promise<EscrowTx>;
  resolveMilestoneDispute(escrowId: string, index: number, resolver: Keypair, distributions: Array<{ address: string; amount: bigint }>): Promise<EscrowTx>;
  getEscrow(escrowId: string): Promise<EscrowState | null>;
  viewerUrl(escrowId: string): string;
  /** Mock only: mirror a funding transfer so release preconditions behave like the contract. */
  mockFund?(escrowId: string, amount: bigint): void;
}

export interface TrustlessWorkConfig {
  mode: AdapterMode;
  baseUrl?: string;
  apiKey?: string;
  networkPassphrase: string;
  viewerUrl?: string;
  feeBps?: number;
  timeoutMs?: number;
}

const log = logger.child({ adapter: 'trustlesswork' });

// ------------------------------------------------------------------ live

class LiveTrustlessWork implements TrustlessWorkClient {
  readonly mode = 'live' as const;
  readonly feeBps: number;
  private readonly base: string;
  private readonly viewer: string;
  private readonly timeoutMs: number;
  constructor(private readonly cfg: TrustlessWorkConfig & { apiKey: string }) {
    this.base = (cfg.baseUrl ?? TRUSTLESS_WORK_TESTNET).replace(/\/$/, '');
    this.viewer = (cfg.viewerUrl ?? TRUSTLESS_WORK_VIEWER).replace(/\/$/, '');
    this.feeBps = cfg.feeBps ?? DEFAULT_PROTOCOL_FEE_BPS;
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  viewerUrl(escrowId: string): string {
    return `${this.viewer}/escrow/${escrowId}`;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const url = `${this.base}${path}`;
    return withRetry(
      async (signal) => {
        const res = await fetch(url, { method, signal, headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.apiKey }, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await res.text();
        if (!res.ok) throw new HttpError(res.status, text, url);
        return text.length ? (JSON.parse(text) as unknown) : null;
      },
      { timeoutMs: this.timeoutMs, retries: 2, retryOn: retryOnTransient },
    );
  }

  private translate(err: unknown, step: string): TrustlessWorkError {
    if (err instanceof TrustlessWorkError) return err;
    if (err instanceof HttpError) {
      let message = err.body.slice(0, 300);
      try {
        const parsed = ApiErrorBody.safeParse(JSON.parse(err.body) as unknown);
        if (parsed.success && parsed.data.message) message = Array.isArray(parsed.data.message) ? parsed.data.message.join('; ') : parsed.data.message;
      } catch {
        /* keep the raw body */
      }
      if (/escrow not found/i.test(message) && /release|resolve|withdraw/.test(step)) {
        return new TrustlessWorkError('blocked_asset', `${step}: the API could not build the payout ("${message}"). SP10: this happens when the Trustless Work fee address cannot hold the escrow's asset (it holds USDC only); the funds stay in the escrow.`, err.status);
      }
      if (/not found/i.test(message)) return new TrustlessWorkError('not_found', `${step}: ${message}`, err.status);
      if (err.status === 401) return new TrustlessWorkError('api', `${step}: unauthorized (check TRUSTLESS_WORK_API_KEY)`, 401);
      if (err.status === 400 && /validation/i.test(message)) return new TrustlessWorkError('validation', `${step}: ${message}`, 400);
      if (err.status === 400 || err.status === 500) return new TrustlessWorkError('precondition', `${step}: ${message}`, err.status);
      return new TrustlessWorkError('api', `${step}: HTTP ${err.status} ${message}`, err.status);
    }
    return new TrustlessWorkError('api', `${step}: ${(err as Error).message}`.slice(0, 300));
  }

  /** build -> sign -> send. Returns the local tx hash (the API confirms with status SUCCESS). */
  private async write(step: string, path: string, body: unknown, signer: Keypair): Promise<{ hash: string; response: z.infer<typeof SendResponse> }> {
    const t0 = Date.now();
    try {
      const built = BuildResponse.safeParse(await this.request('POST', path, body));
      if (!built.success) throw new TrustlessWorkError('api', `${step}: unexpected build response`);
      const tx = TransactionBuilder.fromXDR(built.data.unsignedTransaction, this.cfg.networkPassphrase);
      tx.sign(signer);
      const hash = Buffer.from(tx.hash()).toString('hex');
      const sent = SendResponse.safeParse(await this.request('POST', '/helper/send-transaction', { signedXdr: tx.toXDR() }));
      if (!sent.success) throw new TrustlessWorkError('api', `${step}: unexpected send response`);
      if (sent.data.status && sent.data.status !== 'SUCCESS') throw new TrustlessWorkError('api', `${step}: ${sent.data.message ?? sent.data.status}`);
      log.info({ step, hash, signer: signer.publicKey(), ms: Date.now() - t0 }, 'trustless work write');
      return { hash, response: sent.data };
    } catch (err) {
      const e = this.translate(err, step);
      log.warn({ step, code: e.code, err: e.message, ms: Date.now() - t0 }, 'trustless work write failed');
      throw e;
    }
  }

  async deploy(input: DeployEscrowInput): Promise<{ escrowId: string; txHash: string; mode: AdapterMode }> {
    const body = {
      signer: input.signer.publicKey(),
      engagementId: input.engagementId,
      title: input.title,
      description: input.description,
      roles: input.roles,
      platformFee: 0,
      milestones: input.milestones.map((m) => ({ description: m.description, amount: stroopsToApiAmount(m.amount), receiver: m.receiver })),
      trustline: { address: input.asset.issuer, symbol: input.asset.code },
    };
    const r = await this.write('deploy', '/deployer/multi-release', body, input.signer);
    const escrowId = r.response.contractId;
    if (!escrowId || !StrKey.isValidContract(escrowId)) throw new TrustlessWorkError('api', 'deploy: the API returned no escrow contract id');
    return { escrowId, txHash: r.hash, mode: 'live' };
  }

  async approveMilestone(escrowId: string, index: number, approver: Keypair): Promise<EscrowTx> {
    const r = await this.write('approve', '/escrow/multi-release/approve-milestone', { contractId: escrowId, milestoneIndex: String(index), approver: approver.publicKey() }, approver);
    return { txHash: r.hash, mode: 'live' };
  }

  async releaseMilestone(escrowId: string, index: number, releaseSigner: Keypair): Promise<EscrowTx> {
    const r = await this.write('release', '/escrow/multi-release/release-milestone-funds', { contractId: escrowId, milestoneIndex: String(index), releaseSigner: releaseSigner.publicKey() }, releaseSigner);
    return { txHash: r.hash, mode: 'live' };
  }

  async disputeMilestone(escrowId: string, index: number, signer: Keypair): Promise<EscrowTx> {
    const r = await this.write('dispute', '/escrow/multi-release/dispute-milestone', { contractId: escrowId, milestoneIndex: String(index), signer: signer.publicKey() }, signer);
    return { txHash: r.hash, mode: 'live' };
  }

  async resolveMilestoneDispute(escrowId: string, index: number, resolver: Keypair, distributions: Array<{ address: string; amount: bigint }>): Promise<EscrowTx> {
    const body = { contractId: escrowId, milestoneIndex: String(index), disputeResolver: resolver.publicKey(), distributions: distributions.map((d) => ({ address: d.address, amount: stroopsToApiAmount(d.amount) })) };
    const r = await this.write('resolve', '/escrow/multi-release/resolve-milestone-dispute', body, resolver);
    return { txHash: r.hash, mode: 'live' };
  }

  async getEscrow(escrowId: string): Promise<EscrowState | null> {
    try {
      const raw = await this.request('GET', `/helper/get-escrow-by-contract-ids?contractIds[]=${encodeURIComponent(escrowId)}&validateOnChain=true`);
      const parsed = z.array(EscrowRecordSchema).safeParse(raw);
      if (!parsed.success) {
        log.warn({ escrowId, err: parsed.error.issues.map((i) => i.path.join('.')).join(',') }, 'escrow record failed validation');
        return null;
      }
      const rec = parsed.data.find((r) => r.contractId === escrowId) ?? parsed.data[0];
      return rec ? toEscrowState(rec) : null;
    } catch (err) {
      log.warn({ escrowId, err: (err as Error).message.slice(0, 200) }, 'escrow query failed');
      return null;
    }
  }
}

// ------------------------------------------------------------------ mock

interface MockEscrow {
  record: EscrowRecord;
  funded: bigint;
  input: DeployEscrowInput;
}

const fakeHash = (...parts: string[]): string => createHash('sha256').update(parts.join(':')).digest('hex');

class MockTrustlessWork implements TrustlessWorkClient {
  readonly mode = 'mock' as const;
  readonly feeBps: number;
  private readonly escrows = new Map<string, MockEscrow>();
  private readonly viewer: string;
  constructor(cfg: TrustlessWorkConfig) {
    this.feeBps = cfg.feeBps ?? DEFAULT_PROTOCOL_FEE_BPS;
    this.viewer = (cfg.viewerUrl ?? TRUSTLESS_WORK_VIEWER).replace(/\/$/, '');
  }

  viewerUrl(escrowId: string): string {
    return `${this.viewer}/escrow/${escrowId}`;
  }

  private get(escrowId: string): MockEscrow {
    const e = this.escrows.get(escrowId);
    if (!e) throw new TrustlessWorkError('not_found', `mock: escrow ${escrowId} not found`, 400);
    return e;
  }

  private milestone(e: MockEscrow, index: number) {
    const m = e.record.milestones[index];
    if (!m) throw new TrustlessWorkError('precondition', 'Invalid milestone index', 400);
    m.flags = m.flags ?? {};
    return m;
  }

  private tx(step: string, escrowId: string, signer: Keypair): EscrowTx {
    const txHash = fakeHash('trustlesswork', step, escrowId, signer.publicKey(), String(Date.now()), String(Math.random()));
    log.info({ step, escrowId, signer: signer.publicKey(), txHash }, 'trustless work write (MOCK)');
    return { txHash, mode: 'mock' };
  }

  async deploy(input: DeployEscrowInput): Promise<{ escrowId: string; txHash: string; mode: AdapterMode }> {
    if (input.milestones.length === 0) throw new TrustlessWorkError('precondition', 'Escrow initialized without milestone', 400);
    if (input.milestones.some((m) => m.amount <= 0n)) throw new TrustlessWorkError('precondition', 'Amount cannot be zero', 400);
    const escrowId = StrKey.encodeContract(createHash('sha256').update(`trustlesswork:${input.engagementId}`).digest());
    const record: EscrowRecord = {
      contractId: escrowId,
      engagementId: input.engagementId,
      type: 'multi-release',
      platformFee: 0,
      roles: { ...input.roles },
      trustline: { address: input.asset.issuer, symbol: input.asset.code },
      milestones: input.milestones.map((m) => ({ description: m.description, amount: stroopsToApiAmount(m.amount), status: 'pending', receiver: m.receiver, flags: { approved: false, released: false, disputed: false, resolved: false } })),
      balance: 0,
    };
    this.escrows.set(escrowId, { record, funded: 0n, input });
    const t = this.tx('deploy', escrowId, input.signer);
    return { escrowId, txHash: t.txHash, mode: 'mock' };
  }

  mockFund(escrowId: string, amount: bigint): void {
    const e = this.get(escrowId);
    e.funded += amount;
    e.record.balance = stroopsToApiAmount(e.funded);
  }

  async approveMilestone(escrowId: string, index: number, approver: Keypair): Promise<EscrowTx> {
    const e = this.get(escrowId);
    if (approver.publicKey() !== e.record.roles.approver) throw new TrustlessWorkError('precondition', 'Only the approver can change milestone flag', 400);
    const m = this.milestone(e, index);
    if (m.flags?.approved) throw new TrustlessWorkError('precondition', 'You cannot approve a milestone that has already been approved previously', 400);
    m.flags = { ...m.flags, approved: true };
    m.status = 'approved';
    return this.tx('approve', escrowId, approver);
  }

  async releaseMilestone(escrowId: string, index: number, releaseSigner: Keypair): Promise<EscrowTx> {
    const e = this.get(escrowId);
    if (releaseSigner.publicKey() !== e.record.roles.releaseSigner) throw new TrustlessWorkError('precondition', 'Only the release signer can release the escrow funds', 400);
    const m = this.milestone(e, index);
    if (m.flags?.released) throw new TrustlessWorkError('precondition', 'This milestone is already released', 400);
    if (m.flags?.disputed) throw new TrustlessWorkError('precondition', 'Milestone has been opened for dispute resolution', 400);
    if (!m.flags?.approved) throw new TrustlessWorkError('precondition', 'The milestone must be completed to release funds', 400);
    const amount = apiAmountToStroops(m.amount);
    if (e.funded < amount) throw new TrustlessWorkError('precondition', 'The escrow balance is not enough for this milestone', 400);
    e.funded -= amount;
    e.record.balance = stroopsToApiAmount(e.funded);
    m.flags = { ...m.flags, released: true };
    m.status = 'released';
    return this.tx('release', escrowId, releaseSigner);
  }

  async disputeMilestone(escrowId: string, index: number, signer: Keypair): Promise<EscrowTx> {
    const e = this.get(escrowId);
    const r = e.record.roles;
    if (signer.publicKey() === r.disputeResolver) throw new TrustlessWorkError('precondition', 'The dispute resolver cannot dispute the milestone', 400);
    if (![r.approver, r.serviceProvider, r.releaseSigner, r.platformAddress].includes(signer.publicKey()) && !e.record.milestones.some((m) => m.receiver === signer.publicKey())) throw new TrustlessWorkError('precondition', 'You are not authorized to change the dispute flag', 400);
    const m = this.milestone(e, index);
    if (m.flags?.released || m.flags?.resolved) throw new TrustlessWorkError('precondition', 'This milestone is already released or resolved', 400);
    if (m.flags?.disputed) throw new TrustlessWorkError('precondition', 'Escrow already in dispute', 400);
    m.flags = { ...m.flags, disputed: true };
    m.status = 'disputed';
    return this.tx('dispute', escrowId, signer);
  }

  async resolveMilestoneDispute(escrowId: string, index: number, resolver: Keypair, distributions: Array<{ address: string; amount: bigint }>): Promise<EscrowTx> {
    const e = this.get(escrowId);
    if (resolver.publicKey() !== e.record.roles.disputeResolver) throw new TrustlessWorkError('precondition', 'Only the dispute resolver can execute this function', 400);
    const m = this.milestone(e, index);
    if (!m.flags?.disputed) throw new TrustlessWorkError('precondition', 'Escrow not in dispute', 400);
    const total = distributions.reduce((s, d) => s + d.amount, 0n);
    if (distributions.some((d) => d.amount <= 0n) || total <= 0n) throw new TrustlessWorkError('precondition', 'None of the amounts to be transferred should be less or equal than 0', 400);
    if (total > apiAmountToStroops(m.amount)) throw new TrustlessWorkError('precondition', 'Total dispute funds must not exceed the milestone amount', 400);
    if (total > e.funded) throw new TrustlessWorkError('precondition', 'Insufficient funds for resolution', 400);
    e.funded -= total;
    e.record.balance = stroopsToApiAmount(e.funded);
    m.flags = { ...m.flags, resolved: true, disputed: false };
    m.status = 'resolved';
    return this.tx('resolve', escrowId, resolver);
  }

  async getEscrow(escrowId: string): Promise<EscrowState | null> {
    const e = this.escrows.get(escrowId);
    return e ? toEscrowState(EscrowRecordSchema.parse(e.record)) : null;
  }
}

export function makeTrustlessWork(cfg: TrustlessWorkConfig): TrustlessWorkClient {
  if (cfg.mode === 'live') {
    if (!cfg.apiKey) throw new Error('TRUSTLESS_WORK_API_KEY is required in live mode');
    return new LiveTrustlessWork({ ...cfg, apiKey: cfg.apiKey });
  }
  return new MockTrustlessWork(cfg);
}
