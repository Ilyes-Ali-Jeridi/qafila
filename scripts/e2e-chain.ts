/**
 * pnpm e2e:chain: full chain integration with G keypairs (PLAN 3.4, 12).
 *
 *   tsx scripts/e2e-chain.ts [--network local|testnet] [--keep]
 *
 * Local (default): starts `stellar/quickstart --local --protocol-version 29` in docker (container qafila-e2e),
 * funds fresh keys from the local friendbot, issues a test settlement asset, uploads and
 * deploys qafila_deals, then runs: happy path, late fee and charity sweep, abort from
 * Funded / DepositPaid (at fault) / Owned (not at fault), sold default with capped
 * recovery, and cancel_unfunded. Every step checks balances and invariant 1
 * (contract token balance == books). Exit code 1 on any failure.
 *
 * `--network testnet` runs the same scenarios against testnet with friendbot-funded
 * fresh keys and a fresh test asset (slower, about 12 minutes).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc as RpcNs,
  scValToNative,
  type Account,
  type Transaction,
} from '@stellar/stellar-sdk';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import { Client, Errors, type Config, type Deal, type DealTerms } from '@qafila/contract-client';
import {
  ContractError,
  ONE,
  SubmitQueue,
  call,
  createShareToken,
  makeClient,
  makeRpc,
  repoRoot,
  signList,
  signShipped,
  sorobanTx,
  stroopsToDecimal,
  view,
  type AttestContext,
  type NetworkConfig,
  type SignedClient,
} from '@qafila/chain';

const execFileP = promisify(execFile);

// ------------------------------------------------------------------ arguments

const { values: args } = parseArgs({
  options: {
    network: { type: 'string', default: 'local' },
    keep: { type: 'boolean', default: false },
  },
});
const NETWORK = args.network === 'testnet' ? 'testnet' : 'local';
const KEEP = args.keep === true;

const NETWORKS: Record<'local' | 'testnet', NetworkConfig & { friendbot: string }> = {
  local: {
    network: 'local',
    rpcUrl: 'http://localhost:8000/soroban/rpc',
    horizonUrl: 'http://localhost:8000',
    passphrase: 'Standalone Network ; February 2017',
    friendbot: 'http://localhost:8000/friendbot',
  },
  testnet: {
    network: 'testnet',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    passphrase: 'Test SDF Network ; September 2015',
    friendbot: 'https://friendbot.stellar.org',
  },
};
const NET = NETWORKS[NETWORK];
const CONTAINER = 'qafila-e2e';

// ------------------------------------------------------------------ amounts

const Q = (n: number | bigint): bigint => BigInt(n) * ONE;
const COST = Q(10_000);
const MARKUP = Q(800);
const FEE = Q(200);
const LATE_FEE = Q(50);
const SECURITY = Q(2_000);
const DEPOSIT_BPS = 3000;
const SUPPLIER_DEPOSIT = Q(3_000);
const SUPPLIER_BALANCE = Q(7_000);
const PRICE = COST + MARKUP; // 10,800
const REST = PRICE - SECURITY; // 8,800
const INVEST = [Q(5_000), Q(3_000), Q(2_000)];

const CONFIG: Config = {
  max_markup_bps: 1500,
  max_deposit_bps: 3000,
  max_investors_per_deal: 100,
  min_tenor_secs: 60n,
  grace_secs: 60n,
  base_importer_limit: Q(200_000),
  limit_step: Q(10_000),
  min_security_bps: 2000,
  security_step_bps: 250,
  security_floor_bps: 1000,
  max_extension_secs: 600n,
};

// ------------------------------------------------------------------ helpers

const log = (s: string) => console.log(s);
const now = (): bigint => BigInt(Math.floor(Date.now() / 1000));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sha = (s: string): Buffer => createHash('sha256').update(s).digest();
const fmt = (v: bigint): string => stroopsToDecimal(v).replace(/\.?0+$/, '');
const short = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;

class CheckError extends Error {}

function eq(label: string, actual: bigint | number | string | boolean, expected: bigint | number | string | boolean): void {
  const a = typeof actual === 'bigint' ? actual.toString() : String(actual);
  const e = typeof expected === 'bigint' ? expected.toString() : String(expected);
  if (a !== e) throw new CheckError(`${label}: expected ${e}, got ${a}`);
}

function stateOf(d: Deal): string {
  return d.state.tag;
}

async function expectError<T>(label: string, p: Promise<T>, code: number): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ContractError && e.code === code) return;
    throw new CheckError(`${label}: expected contract error #${code} ${Errors[code as keyof typeof Errors]?.message ?? ''}, got ${e instanceof Error ? e.message : String(e)}`);
  }
  throw new CheckError(`${label}: expected contract error #${code}, call succeeded`);
}

// ------------------------------------------------------------------ network

async function rpcHealthy(cfg: NetworkConfig): Promise<boolean> {
  try {
    const h = await makeRpc(cfg).getHealth();
    return h.status === 'healthy';
  } catch {
    return false;
  }
}

async function ensureLocalNetwork(): Promise<boolean> {
  if (await rpcHealthy(NET)) {
    log('local network already running');
    return false;
  }
  const { stdout } = await execFileP('docker', ['images', '-q', 'stellar/quickstart:latest']);
  if (stdout.trim() === '') {
    log('pulling stellar/quickstart:latest (slow on venue Wi-Fi)...');
    await execFileP('docker', ['pull', 'stellar/quickstart:latest'], { timeout: 20 * 60_000 });
  }
  await execFileP('docker', ['rm', '-f', CONTAINER]).catch(() => undefined);
  await execFileP('docker', [
    'run', '--rm', '-d', '-p', '8000:8000', '--name', CONTAINER,
    // quickstart v30 defaults the local network to protocol 28, where every Soroban simulation
    // fails with Error(Context, InternalError); protocol 29 matches testnet and works.
    'stellar/quickstart:latest', '--local', '--enable', 'rpc,horizon', '--protocol-version', '29', '--limits', 'testnet',
  ]);
  log(`started container ${CONTAINER}, waiting for RPC...`);
  for (let i = 0; i < 90; i += 1) {
    if (await rpcHealthy(NET)) {
      // Horizon and friendbot come up a little later.
      for (let j = 0; j < 60; j += 1) {
        try {
          const r = await fetch(`${NET.horizonUrl}/`);
          if (r.ok) break;
        } catch {
          // keep waiting
        }
        await sleep(2000);
      }
      // A freshly started quickstart reports healthy before it closes ledgers steadily; the first
      // transactions then sit in PENDING past any timeout. Wait for a few ledgers to close first.
      const server = makeRpc(NET);
      const start = (await server.getLatestLedger()).sequence;
      for (let k = 0; k < 60; k += 1) {
        const seq = (await server.getLatestLedger()).sequence;
        if (seq >= start + 5) break;
        await sleep(2000);
      }
      log('local network healthy');
      return true;
    }
    await sleep(2000);
  }
  throw new Error('local network did not become healthy in 3 minutes');
}

async function stopLocalNetwork(): Promise<void> {
  await execFileP('docker', ['rm', '-f', CONTAINER]).catch(() => undefined);
}

async function friendbot(pk: string): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const r = await fetch(`${NET.friendbot}?addr=${encodeURIComponent(pk)}`);
      if (r.ok) return;
      const body = await r.text();
      if (/createAccountAlreadyExist|already funded/i.test(body)) return;
      throw new Error(`friendbot ${r.status}: ${body.slice(0, 120)}`);
    } catch (e) {
      if (attempt === 5) throw e;
      await sleep(1500 * attempt);
    }
  }
}

// ------------------------------------------------------------------ harness

interface Party {
  kp: Keypair;
  queue: SubmitQueue;
}

class Harness {
  readonly rpc = makeRpc(NET);
  readonly admin: Party;
  readonly agent: Party;
  readonly importer: Party;
  readonly issuer: Party;
  readonly funder: Party;
  readonly investors: Party[];
  readonly supplier = Keypair.random();
  readonly charity = Keypair.random();
  readonly treasury = Keypair.random();
  readonly verifier = Keypair.random();
  asset!: Asset;
  sacId!: string;
  contractId!: string;
  attest!: AttestContext;
  private clients = new Map<string, SignedClient>();
  /** Tracked expected DealBalance per deal id (the model). */
  readonly dealBalance = new Map<string, bigint>();
  /** Share asset per deal id: G-address investors need a trustline before shares are minted (SP4). */
  readonly shareAssets = new Map<string, Asset>();
  readonly txs: string[] = [];
  private failures: string[] = [];
  private passes: string[] = [];

  constructor() {
    const party = (): Party => {
      const kp = Keypair.random();
      return { kp, queue: new SubmitQueue({ rpc: this.rpc, keypair: kp, txTimeoutMs: 90_000 }) };
    };
    this.admin = party();
    this.agent = party();
    this.importer = party();
    this.issuer = party();
    this.funder = party();
    this.investors = [party(), party(), party()];
  }

  client(p: Party): SignedClient {
    const key = p.kp.publicKey();
    let c = this.clients.get(key);
    if (!c) {
      c = makeClient({ contractId: this.contractId, cfg: NET, keypair: p.kp });
      // Share the harness queue so classic and contract calls from one key never race.
      c = { ...c, queue: p.queue };
      this.clients.set(key, c);
    }
    return c;
  }

  // -------------------------------------------------------------- setup

  async fundAll(): Promise<void> {
    const all = [this.admin, this.agent, this.importer, this.issuer, this.funder, ...this.investors].map((p) => p.kp.publicKey());
    all.push(this.supplier.publicKey(), this.charity.publicKey(), this.treasury.publicKey());
    await Promise.all(all.map((pk) => friendbot(pk)));
    log(`funded ${all.length} accounts from friendbot`);
  }

  classic(account: Account, ops: ReturnType<typeof Operation.payment>[]): Transaction {
    const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: NET.passphrase });
    for (const op of ops) b.addOperation(op);
    return b.setTimeout(120).build();
  }

  async issueSettlement(): Promise<void> {
    this.asset = new Asset('QUSD', this.issuer.kp.publicKey());
    this.sacId = this.asset.contractId(NET.passphrase);
    const r = await this.admin.queue.submit((acc) =>
      sorobanTx(this.rpc, acc, NET.passphrase, Operation.createStellarAssetContract({ asset: this.asset })),
    );
    this.txs.push(r.hash);
    // Trustlines for every G account that holds the token.
    const holders: Party[] = [this.admin, this.importer, ...this.investors];
    const passive = [this.supplier, this.charity, this.treasury];
    await Promise.all([
      ...holders.map((p) => p.queue.submit((acc) => this.classic(acc, [Operation.changeTrust({ asset: this.asset })]))),
      ...passive.map((kp) => {
        const q = new SubmitQueue({ rpc: this.rpc, keypair: kp });
        return q.submit((acc) => this.classic(acc, [Operation.changeTrust({ asset: this.asset })]));
      }),
    ]);
    // Mints: importer 60k (7 securities + repayments), investors 50k/30k/20k, admin 40k (recoveries).
    const mints: [string, bigint][] = [
      [this.importer.kp.publicKey(), Q(60_000)],
      [this.investors[0]!.kp.publicKey(), Q(50_000)],
      [this.investors[1]!.kp.publicKey(), Q(30_000)],
      [this.investors[2]!.kp.publicKey(), Q(20_000)],
      [this.admin.kp.publicKey(), Q(40_000)],
    ];
    await this.issuer.queue.submit((acc) =>
      this.classic(
        acc,
        mints.map(([to, amt]) => Operation.payment({ destination: to, asset: this.asset, amount: stroopsToDecimal(amt) })),
      ),
    );
    log(`settlement asset QUSD:${short(this.issuer.kp.publicKey())} SAC ${this.sacId}`);
  }

  async deployContract(): Promise<void> {
    const wasm = readFileSync(resolve(repoRoot(), 'contracts/target/wasm32v1-none/release/qafila_deals.wasm'));
    const wasmHash = createHash('sha256').update(wasm).digest();
    const up = await this.admin.queue.submit((acc) => sorobanTx(this.rpc, acc, NET.passphrase, Operation.uploadContractWasm({ wasm })));
    this.txs.push(up.hash);
    const signer = basicNodeSigner(this.admin.kp, NET.passphrase);
    const deployed = await this.admin.queue.run(async () => {
      const tx = await Client.deploy(
        {
          admin: this.admin.kp.publicKey(),
          verifier: Buffer.from(this.verifier.rawPublicKey()),
          charity: this.charity.publicKey(),
          treasury: this.treasury.publicKey(),
          settlement: this.sacId,
          config: CONFIG,
        },
        {
          wasmHash,
          publicKey: this.admin.kp.publicKey(),
          signTransaction: signer.signTransaction,
          signAuthEntry: signer.signAuthEntry,
          rpcUrl: NET.rpcUrl,
          networkPassphrase: NET.passphrase,
          allowHttp: NET.rpcUrl.startsWith('http://'),
          errorTypes: Errors,
        },
      );
      const sent = await tx.signAndSend();
      return { id: sent.result.options.contractId, hash: sent.sendTransactionResponse?.hash ?? '' };
    });
    this.contractId = deployed.id;
    this.txs.push(deployed.hash);
    this.attest = { contractId: this.contractId, passphrase: NET.passphrase, verifierSecret: this.verifier };
    log(`qafila_deals deployed ${this.contractId} (wasm ${wasmHash.toString('hex').slice(0, 12)}…)`);
    await call(this.client(this.admin), (c) => c.set_agent({ agent: this.agent.kp.publicKey() }));
    for (const inv of this.investors) {
      await call(this.client(this.admin), (c) => c.approve_investor({ investor: inv.kp.publicKey() }));
    }
    log('agent set, 3 investors approved');
  }

  // -------------------------------------------------------------- reads

  async balance(addr: string): Promise<bigint> {
    const account = await this.rpc.getAccount(this.admin.kp.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NET.passphrase })
      .addOperation(new Contract(this.sacId).call('balance', new Address(addr).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await this.rpc.simulateTransaction(tx);
    if (RpcNs.Api.isSimulationError(sim)) throw new Error(`balance simulation failed: ${sim.error}`);
    if (!RpcNs.Api.isSimulationSuccess(sim) || !sim.result) throw new Error('balance simulation returned nothing');
    const v = scValToNative(sim.result.retval) as unknown;
    if (typeof v !== 'bigint') throw new Error('balance is not i128');
    return v;
  }

  async deal(id: bigint): Promise<Deal> {
    return view(await this.client(this.admin).client.get_deal({ deal_id: id }));
  }

  /** Invariant 1: contract token balance == owed totals + sum of open (DealBalance + security). */
  async books(label: string): Promise<void> {
    const c = this.client(this.admin).client;
    const owed = await view(await c.owed());
    let sum = owed.charity + owed.treasury + owed.refunds + owed.promises_held;
    for (const [id, bal] of this.dealBalance) {
      const d = await this.deal(BigInt(id));
      sum += bal + d.security;
    }
    const actual = await this.balance(this.contractId);
    eq(`books after ${label}`, actual, sum);
  }

  bump(id: bigint, delta: bigint): void {
    const k = id.toString();
    this.dealBalance.set(k, (this.dealBalance.get(k) ?? 0n) + delta);
  }

  async expectBalance(label: string, addr: string, expected: bigint): Promise<void> {
    eq(`${label} balance`, await this.balance(addr), expected);
  }

  // -------------------------------------------------------------- deal steps

  terms(n: number, share: string, overrides: Partial<DealTerms> = {}): DealTerms {
    return {
      importer: this.importer.kp.publicKey(),
      supplier: this.supplier.publicKey(),
      share_token: share,
      payout_token: this.sacId,
      cost: COST,
      deposit_bps: DEPOSIT_BPS,
      markup: MARKUP,
      platform_fee: FEE,
      late_fee: LATE_FEE,
      funding_deadline: now() + 3600n,
      accept_window_secs: 3600n,
      tenor_secs: 3600n,
      listing_fingerprint: sha(`listing-${n}-${this.contractId}`),
      report_hash: sha(`report-${n}`),
      promise_hash: sha(`promise-${n}`),
      halal_ok: true,
      payment_mode: { tag: 'Native', values: undefined },
      security: SECURITY,
      ...overrides,
    };
  }

  /** Promise, share token, list. Returns the deal id and terms. */
  async list(n: number, overrides: Partial<DealTerms> = {}): Promise<{ id: bigint; terms: DealTerms }> {
    const fp = sha(`listing-${n}-${this.contractId}`);
    const promiseHash = sha(`promise-${n}`);
    const p = await call(this.client(this.importer), (c) =>
      c.promise_purchase({ importer: this.importer.kp.publicKey(), listing_fingerprint: fp, promise_hash: promiseHash, security: SECURITY }),
    );
    this.tx(`promise #${n}`, p.hash);
    const share = await createShareToken({
      dealNumber: n,
      adminContractId: this.contractId,
      cfg: NET,
      rpc: this.rpc,
      funder: this.funder.kp,
      homeDomain: 'qafila.dev',
    });
    const terms = this.terms(n, share.sacId, overrides);
    const sig = signList(terms, this.attest);
    const listed = await call(this.client(this.admin), (c) => c.list_deal({ terms, sig: sig.sig }));
    const id = listed.result;
    this.dealBalance.set(id.toString(), 0n);
    this.shareAssets.set(id.toString(), new Asset(share.assetCode, share.issuer));
    this.tx(`list #${n} -> deal ${id} share ${share.assetCode}`, listed.hash);
    const d = await this.deal(id);
    eq(`deal ${id} state`, stateOf(d), 'Listed');
    eq(`deal ${id} security`, d.security, SECURITY);
    await this.books(`list ${id}`);
    return { id, terms };
  }

  /** Classic `changeTrust` for the share asset (AUTH_REQUIRED: it starts unauthorized; the contract authorizes for the mint). */
  async shareTrustlines(id: bigint, count: number): Promise<void> {
    const asset = this.shareAssets.get(id.toString());
    if (!asset) throw new CheckError(`no share asset recorded for deal ${id}`);
    await Promise.all(
      this.investors.slice(0, count).map((inv) => inv.queue.submit((acc) => this.classic(acc, [Operation.changeTrust({ asset })]))),
    );
    log(`  share trustlines for ${count} investor(s) on ${asset.getCode()}`);
  }

  async fund(id: bigint, amounts: bigint[] = INVEST): Promise<void> {
    await this.shareTrustlines(id, amounts.length);
    for (let i = 0; i < amounts.length; i += 1) {
      const inv = this.investors[i]!;
      const r = await call(this.client(inv), (c) => c.invest({ investor: inv.kp.publicKey(), deal_id: id, amount: amounts[i]! }));
      eq(`invest ${id} share balance`, r.result, amounts[i]!);
      this.bump(id, amounts[i]!);
      this.tx(`invest ${fmt(amounts[i]!)} by investor ${i + 1} in deal ${id}`, r.hash);
    }
    const d = await this.deal(id);
    const total = amounts.reduce((a, b) => a + b, 0n);
    eq(`deal ${id} funded`, d.funded, total);
    eq(`deal ${id} state`, stateOf(d), total === COST ? 'Funded' : 'Listed');
    await this.books(`fund ${id}`);
  }

  async payDeposit(id: bigint): Promise<void> {
    const before = await this.balance(this.supplier.publicKey());
    const r = await call(this.client(this.agent), (c) => c.pay_supplier_deposit({ caller: this.agent.kp.publicKey(), deal_id: id }));
    eq(`deposit ${id}`, r.result, SUPPLIER_DEPOSIT);
    this.bump(id, -SUPPLIER_DEPOSIT);
    this.tx(`pay_supplier_deposit deal ${id} (agent)`, r.hash);
    await this.expectBalance('supplier', this.supplier.publicKey(), before + SUPPLIER_DEPOSIT);
    eq(`deal ${id} state`, stateOf(await this.deal(id)), 'DepositPaid');
    await this.books(`deposit ${id}`);
  }

  async ship(id: bigint, n: number): Promise<void> {
    const before = await this.balance(this.supplier.publicKey());
    const blFp = sha(`bl-${n}-${this.contractId}`);
    const blReport = sha(`bl-report-${n}`);
    const sig = signShipped(id, blFp, blReport, this.attest);
    const r = await call(this.client(this.agent), (c) =>
      c.confirm_shipment({ caller: this.agent.kp.publicKey(), deal_id: id, bl_fingerprint: blFp, bl_report_hash: blReport, sig: sig.sig }),
    );
    eq(`balance paid ${id}`, r.result, SUPPLIER_BALANCE);
    this.bump(id, -SUPPLIER_BALANCE);
    this.tx(`confirm_shipment deal ${id} (agent, SHIPPED attestation)`, r.hash);
    await this.expectBalance('supplier', this.supplier.publicKey(), before + SUPPLIER_BALANCE);
    eq(`deal ${id} state`, stateOf(await this.deal(id)), 'Owned');
    await this.books(`ship ${id}`);
  }

  async accept(id: bigint): Promise<Deal> {
    const r = await call(this.client(this.importer), (c) => c.accept_murabaha({ deal_id: id }));
    eq(`sale price ${id}`, r.result, PRICE);
    this.bump(id, SECURITY);
    this.tx(`accept_murabaha deal ${id} price ${fmt(PRICE)}, security counted`, r.hash);
    const d = await this.deal(id);
    eq(`deal ${id} state`, stateOf(d), 'Sold');
    eq(`deal ${id} principal_repaid`, d.principal_repaid, SECURITY);
    eq(`deal ${id} security`, d.security, 0n);
    await this.books(`accept ${id}`);
    return d;
  }

  async repay(id: bigint, amount: bigint, expectOutstanding: bigint): Promise<Deal> {
    const r = await call(this.client(this.importer), (c) => c.repay({ deal_id: id, amount }));
    eq(`repay ${id} outstanding`, r.result, expectOutstanding);
    this.bump(id, amount);
    if (expectOutstanding === 0n) this.bump(id, -FEE);
    this.tx(`repay ${fmt(amount)} deal ${id}`, r.hash);
    await this.books(`repay ${id}`);
    return this.deal(id);
  }

  async claimAll(id: bigint, expected: bigint[]): Promise<void> {
    for (let i = 0; i < expected.length; i += 1) {
      const inv = this.investors[i]!;
      const before = await this.balance(inv.kp.publicKey());
      const r = await call(this.client(this.admin), (c) => c.claim({ holder: inv.kp.publicKey(), deal_id: id }));
      eq(`claim ${id} investor ${i + 1}`, r.result, expected[i]!);
      this.bump(id, -expected[i]!);
      this.tx(`claim investor ${i + 1} deal ${id} -> ${fmt(expected[i]!)}`, r.hash);
      await this.expectBalance(`investor ${i + 1}`, inv.kp.publicKey(), before + expected[i]!);
    }
    await this.books(`claims ${id}`);
  }

  async close(id: bigint): Promise<void> {
    const r = await call(this.client(this.admin), (c) => c.close_deal({ deal_id: id }));
    this.tx(`close_deal ${id}`, r.hash);
    const d = await this.deal(id);
    eq(`deal ${id} state`, stateOf(d), 'Closed');
    eq(`deal ${id} paid_out`, d.paid_out, d.distributable);
    this.dealBalance.delete(id.toString());
    await this.books(`close ${id}`);
  }

  async withdrawRefund(expected: bigint): Promise<void> {
    const before = await this.balance(this.importer.kp.publicKey());
    const r = await call(this.client(this.admin), (c) => c.withdraw_refund({ addr: this.importer.kp.publicKey() }));
    eq('withdraw_refund', r.result, expected);
    this.tx(`withdraw_refund importer -> ${fmt(expected)} (triggered by admin)`, r.hash);
    await this.expectBalance('importer', this.importer.kp.publicKey(), before + expected);
    await this.books('withdraw_refund');
  }

  tx(what: string, hash: string | undefined): void {
    if (hash) this.txs.push(hash);
    log(`  ${what}${hash ? `  tx ${hash}` : ''}`);
  }

  // -------------------------------------------------------------- scenarios

  async scenario(name: string, fn: () => Promise<void>): Promise<void> {
    log(`\n== ${name}`);
    const t0 = Date.now();
    try {
      await fn();
      this.passes.push(name);
      log(`PASS ${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      this.failures.push(`${name}: ${m}`);
      log(`FAIL ${name}: ${m}`);
    }
  }

  summary(): number {
    log('\n== summary');
    for (const p of this.passes) log(`PASS ${p}`);
    for (const f of this.failures) log(`FAIL ${f}`);
    log(`${this.passes.length} passed, ${this.failures.length} failed, ${this.txs.length} transactions on ${NETWORK}`);
    return this.failures.length;
  }
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  const started = Date.now();
  let startedContainer = false;
  if (NETWORK === 'local') startedContainer = await ensureLocalNetwork();
  const h = new Harness();
  try {
    await h.fundAll();
    await h.issueSettlement();
    await h.deployContract();
    await h.books('setup');

    // Time-based deals first, so one wait covers them all.
    // b: late fee (tenor 60 s). d: sold default (tenor 60, grace 60). e: cancel (deadline now + 70).
    let b: { id: bigint } | undefined;
    let d: { id: bigint } | undefined;
    let e: { id: bigint } | undefined;
    let waitFrom = Date.now();
    await h.scenario('setup time-based deals (late, default, cancel)', async () => {
      b = await h.list(2, { tenor_secs: 60n });
      await h.fund(b.id);
      await h.payDeposit(b.id);
      await h.ship(b.id, 2);
      await h.accept(b.id);

      d = await h.list(4, { tenor_secs: 60n });
      await h.fund(d.id);
      await h.payDeposit(d.id);
      await h.ship(d.id, 4);
      const sold = await h.accept(d.id);
      await h.repay(d.id, Q(3_000), Q(5_800));
      // One extension, price unchanged.
      await expectError('extend_due too far', call(h.client(h.admin), (c) => c.extend_due({ deal_id: d!.id, new_due_at: sold.due_at + 601n })), 35);
      const ext = await call(h.client(h.admin), (c) => c.extend_due({ deal_id: d!.id, new_due_at: sold.due_at + 30n }));
      h.tx(`extend_due deal ${d.id} +30 s`, ext.hash);
      await expectError('second extension', call(h.client(h.admin), (c) => c.extend_due({ deal_id: d!.id, new_due_at: sold.due_at + 60n })), 36);
      const dd = await h.deal(d.id);
      eq('sale price unchanged after extension', dd.sale_price, PRICE);
      eq('extended flag', dd.extended, true);

      e = await h.list(5, { funding_deadline: now() + 70n });
      await h.fund(e.id, [Q(4_000)]);
      waitFrom = Date.now();
    });

    await h.scenario('a. happy path on time: 10,600 to holders, 200 to treasury', async () => {
      const { id } = await h.list(1);
      await h.fund(id);
      await h.payDeposit(id);
      await h.ship(id, 1);
      await h.accept(id);
      await expectError('overpayment', call(h.client(h.importer), (c) => c.repay({ deal_id: id, amount: REST + 1n })), 7);
      const after = await h.repay(id, REST, 0n);
      eq('state', stateOf(after), 'Repaid');
      eq('late_fee_due', after.late_fee_due, 0n);
      eq('distributable', after.distributable, Q(10_600));
      const owed = await view(await h.client(h.admin).client.owed());
      eq('treasury owed', owed.treasury, FEE);
      const sw = await call(h.client(h.admin), (c) => c.sweep_treasury());
      eq('sweep_treasury', sw.result, FEE);
      h.tx('sweep_treasury 200', sw.hash);
      await h.expectBalance('treasury', h.treasury.publicKey(), FEE);
      await h.claimAll(id, [Q(5_300), Q(3_180), Q(2_120)]);
      await expectError('claim twice', call(h.client(h.admin), (c) => c.claim({ holder: h.investors[0]!.kp.publicKey(), deal_id: id })), 28);
      await h.close(id);
      const stats = await view(await h.client(h.admin).client.importer_stats({ importer: h.importer.kp.publicKey() }));
      eq('importer on_time', stats.on_time, 1);
    });

    await h.scenario('c1. abort from Funded: investors and security refunded in full', async () => {
      const { id } = await h.list(3);
      await h.fund(id);
      const r = await call(h.client(h.admin), (c) => c.abort_deal({ deal_id: id, importer_at_fault: true }));
      h.tx(`abort_deal ${id} from Funded`, r.hash);
      const dd = await h.deal(id);
      eq('state', stateOf(dd), 'Cancelled');
      eq('distributable', dd.distributable, COST);
      eq('security', dd.security, 0n);
      const refund = await view(await h.client(h.admin).client.refund_of({ addr: h.importer.kp.publicKey() }));
      eq('refund owed', refund, SECURITY);
      await h.books(`abort ${id}`);
      await h.claimAll(id, INVEST);
      await h.withdrawRefund(SECURITY);
      await h.close(id);
    });

    await h.scenario('c2. supplier vanished (DepositPaid, at fault): holders get 9,000', async () => {
      const { id } = await h.list(6);
      await h.fund(id);
      await h.payDeposit(id);
      const r = await call(h.client(h.admin), (c) => c.abort_deal({ deal_id: id, importer_at_fault: true }));
      h.tx(`abort_deal ${id} at fault`, r.hash);
      let dd = await h.deal(id);
      eq('state', stateOf(dd), 'Defaulted');
      eq('security kept', dd.security, SECURITY);
      await h.books(`abort ${id}`);
      const f = await call(h.client(h.admin), (c) => c.finalize_default({ deal_id: id }));
      h.tx(`finalize_default ${id}`, f.hash);
      h.bump(id, SECURITY); // 2,000 used to cover the 3,000 loss
      dd = await h.deal(id);
      eq('state', stateOf(dd), 'Liquidated');
      eq('distributable', dd.distributable, Q(9_000));
      eq('security', dd.security, 0n);
      const refund = await view(await h.client(h.admin).client.refund_of({ addr: h.importer.kp.publicKey() }));
      eq('no refund', refund, 0n);
      await h.books(`finalize ${id}`);
      await h.claimAll(id, [Q(4_500), Q(2_700), Q(1_800)]);
      await h.close(id);
      // The importer is now in default: limit 0 and no new promise.
      const limit = await view(await h.client(h.admin).client.importer_limit({ importer: h.importer.kp.publicKey() }));
      eq('importer limit after default', limit, 0n);
    });

    // After c2 the importer is in default, so the remaining listings use a fresh importer? No:
    // the contract blocks promises by a defaulted importer, so c3 must run before c2 would in
    // production. Here we reuse the same importer by having c3 listed earlier? Simpler: c3 uses
    // a second importer account funded now.
    const importer2 = Keypair.random();
    await h.scenario('c3. goods lost (Owned, not at fault): security refunded at abort', async () => {
      await friendbot(importer2.publicKey());
      const q2 = new SubmitQueue({ rpc: h.rpc, keypair: importer2 });
      await q2.submit((acc) => h.classic(acc, [Operation.changeTrust({ asset: h.asset })]));
      await h.issuer.queue.submit((acc) =>
        h.classic(acc, [Operation.payment({ destination: importer2.publicKey(), asset: h.asset, amount: stroopsToDecimal(Q(5_000)) })]),
      );
      const party = { kp: importer2, queue: q2 };
      const n = 7;
      const fp = sha(`listing-${n}-${h.contractId}`);
      const p = await call(h.client(party), (c) =>
        c.promise_purchase({ importer: importer2.publicKey(), listing_fingerprint: fp, promise_hash: sha(`promise-${n}`), security: SECURITY }),
      );
      h.tx(`promise #${n} (importer 2)`, p.hash);
      const share = await createShareToken({ dealNumber: n, adminContractId: h.contractId, cfg: NET, rpc: h.rpc, funder: h.funder.kp, homeDomain: 'qafila.dev' });
      const terms = h.terms(n, share.sacId, { importer: importer2.publicKey() });
      const listed = await call(h.client(h.admin), (c) => c.list_deal({ terms, sig: signList(terms, h.attest).sig }));
      const id = listed.result;
      h.dealBalance.set(id.toString(), 0n);
      h.shareAssets.set(id.toString(), new Asset(share.assetCode, share.issuer));
      h.tx(`list #${n} -> deal ${id}`, listed.hash);
      await h.fund(id);
      await h.payDeposit(id);
      await h.ship(id, n);
      const r = await call(h.client(h.admin), (c) => c.abort_deal({ deal_id: id, importer_at_fault: false }));
      h.tx(`abort_deal ${id} not at fault`, r.hash);
      let dd = await h.deal(id);
      eq('state', stateOf(dd), 'Defaulted');
      eq('security refunded', dd.security, 0n);
      const refund = await view(await h.client(h.admin).client.refund_of({ addr: importer2.publicKey() }));
      eq('refund owed to importer 2', refund, SECURITY);
      await h.books(`abort ${id}`);
      // Insurance recovers 6,000 (admin pays it in).
      const rec = await call(h.client(h.admin), (c) => c.deposit_recovery({ deal_id: id, from: h.admin.kp.publicKey(), amount: Q(6_000) }));
      h.tx(`deposit_recovery 6,000 deal ${id}`, rec.hash);
      h.bump(id, Q(6_000));
      const f = await call(h.client(h.admin), (c) => c.finalize_default({ deal_id: id }));
      h.tx(`finalize_default ${id}`, f.hash);
      dd = await h.deal(id);
      eq('distributable', dd.distributable, Q(6_000));
      await h.books(`finalize ${id}`);
      await h.claimAll(id, [Q(3_000), Q(1_800), Q(1_200)]);
      const before = await h.balance(importer2.publicKey());
      const w = await call(h.client(h.admin), (c) => c.withdraw_refund({ addr: importer2.publicKey() }));
      eq('withdraw_refund importer 2', w.result, SECURITY);
      h.tx('withdraw_refund importer 2', w.hash);
      await h.expectBalance('importer 2', importer2.publicKey(), before + SECURITY);
      await h.close(id);
    });

    // Wait until the time-based deals are ripe: default needs due (+30 s ext) + grace 60 + 1.
    const needed = 60 + 30 + 60 + 5;
    const elapsed = Math.round((Date.now() - waitFrom) / 1000);
    if (elapsed < needed) {
      log(`\nwaiting ${needed - elapsed} s for the late, default and cancel deals to ripen...`);
      await sleep((needed - elapsed) * 1000);
    }

    await h.scenario('b. late repayment: investors paid in full, 50 late fee swept to charity', async () => {
      if (!b) throw new CheckError('deal b not listed');
      const id = b.id;
      const after = await h.repay(id, REST, 0n);
      eq('state', stateOf(after), 'Repaid');
      eq('late_fee_due', after.late_fee_due, LATE_FEE);
      eq('distributable', after.distributable, Q(10_600));
      await h.claimAll(id, [Q(5_300), Q(3_180), Q(2_120)]);
      await expectError('late fee overpayment', call(h.client(h.importer), (c) => c.pay_late_fee({ deal_id: id, amount: LATE_FEE + 1n })), 7);
      const lf = await call(h.client(h.importer), (c) => c.pay_late_fee({ deal_id: id, amount: LATE_FEE }));
      h.tx(`pay_late_fee 50 deal ${id}`, lf.hash);
      const owed = await view(await h.client(h.admin).client.owed());
      eq('charity owed', owed.charity, LATE_FEE);
      await h.books(`late fee ${id}`);
      const sw = await call(h.client(h.admin), (c) => c.sweep_charity());
      eq('sweep_charity', sw.result, LATE_FEE);
      h.tx('sweep_charity 50', sw.hash);
      await h.expectBalance('charity', h.charity.publicKey(), LATE_FEE);
      await h.close(id);
      const stats = await view(await h.client(h.admin).client.importer_stats({ importer: h.importer.kp.publicKey() }));
      eq('importer late', stats.late, 1);
    });

    await h.scenario('d. sold default: 7,500 to holders, recovery capped at 5,800', async () => {
      if (!d) throw new CheckError('deal d not listed');
      const id = d.id;
      const md = await call(h.client(h.admin), (c) => c.mark_default({ deal_id: id }));
      h.tx(`mark_default ${id}`, md.hash);
      eq('state', stateOf(await h.deal(id)), 'Defaulted');
      await expectError('recovery above outstanding', call(h.client(h.admin), (c) => c.deposit_recovery({ deal_id: id, from: h.admin.kp.publicKey(), amount: Q(5_801) })), 7);
      const rec = await call(h.client(h.admin), (c) => c.deposit_recovery({ deal_id: id, from: h.admin.kp.publicKey(), amount: Q(2_500) }));
      h.tx(`deposit_recovery 2,500 deal ${id}`, rec.hash);
      h.bump(id, Q(2_500));
      await h.books(`recovery ${id}`);
      const treasuryBefore = (await view(await h.client(h.admin).client.owed())).treasury;
      const f = await call(h.client(h.admin), (c) => c.finalize_default({ deal_id: id }));
      h.tx(`finalize_default ${id}`, f.hash);
      const dd = await h.deal(id);
      eq('state', stateOf(dd), 'Liquidated');
      eq('distributable', dd.distributable, Q(7_500));
      // The platform fee of a defaulted deal is forfeited: treasury owed does not grow.
      eq('fee forfeited', (await view(await h.client(h.admin).client.owed())).treasury, treasuryBefore);
      await h.claimAll(id, [Q(3_750), Q(2_250), Q(1_500)]);
      await h.close(id);
    });

    await h.scenario('e. cancel_unfunded: 4,000 back to the investor, security back to the importer', async () => {
      if (!e) throw new CheckError('deal e not listed');
      const id = e.id;
      const r = await call(h.client(h.admin), (c) => c.cancel_unfunded({ deal_id: id }));
      h.tx(`cancel_unfunded ${id}`, r.hash);
      const dd = await h.deal(id);
      eq('state', stateOf(dd), 'Cancelled');
      eq('distributable', dd.distributable, Q(4_000));
      await h.books(`cancel ${id}`);
      await h.claimAll(id, [Q(4_000)]);
      await h.withdrawRefund(SECURITY);
      await h.close(id);
    });

    await h.scenario('final books: nothing stranded in the contract', async () => {
      await h.books('end');
      // Deal b's platform fee is still owed to the treasury; sweep what is owed, then the books must be empty.
      // A sweep with nothing owed writes no ledger entry, so the generated client treats it as a read
      // call and refuses to send it: only sweep non-zero amounts (the agent must do the same).
      const pending = await view(await h.client(h.admin).client.owed());
      if (pending.treasury > 0n) {
        const st = await call(h.client(h.admin), (c) => c.sweep_treasury());
        h.tx(`sweep_treasury ${fmt(st.result)}`, st.hash);
      }
      if (pending.charity > 0n) {
        const sc = await call(h.client(h.admin), (c) => c.sweep_charity());
        h.tx(`sweep_charity ${fmt(sc.result)}`, sc.hash);
      }
      const owed = await view(await h.client(h.admin).client.owed());
      eq('owed total', owed.charity + owed.treasury + owed.refunds + owed.promises_held, 0n);
      eq('contract balance', await h.balance(h.contractId), 0n);
    });
  } finally {
    const fails = h.summary();
    log(`total ${Math.round((Date.now() - started) / 1000)} s`);
    if (NETWORK === 'local' && startedContainer && !KEEP) {
      await stopLocalNetwork();
      log(`stopped container ${CONTAINER} (pass --keep to leave it running)`);
    }
    process.exitCode = fails > 0 ? 1 : 0;
  }
}

main().catch((e: unknown) => {
  console.error(`e2e-chain crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
