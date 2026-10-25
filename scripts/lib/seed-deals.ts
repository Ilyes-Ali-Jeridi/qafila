/**
 * The three demo deals (PLAN 3.4, FLOWS 9): venue deal (open), shipping deal
 * (deposit paid, waiting for its B/L), late deal (owned, 120 s tenor, ready to sign).
 * Every deal locks `required_security` from the demo importer and takes 5 % co-invest.
 * Shared by scripts/seed.ts and scripts/demo-reset.ts (which never redeploys).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DealTerms } from '@qafila/contract-client';
import { hashCanonical, sha256, shipmentFingerprint } from '@qafila/shared/attestation';
import { Asset, Keypair } from '@stellar/stellar-sdk';
import {
  ONE,
  adminClient,
  call,
  clientFor,
  createShareToken,
  ensureInvestorApproved,
  ensureTrustline,
  explorerTxUrl,
  faucetSend,
  loadChainEnv,
  loadDeployment,
  networkConfig,
  qusdBalance,
  qusdContext,
  repoRoot,
  requireEnv,
  signList,
  signShipped,
  view,
  type DeploymentInstance,
  type SignedClient,
} from '@qafila/chain';
import { readEnvValue, setEnvValues } from './env-file.ts';

export interface SeedOptions {
  instance: DeploymentInstance;
  /** Distinguishes fingerprints between runs. */
  tag: string;
  /** demo-reset: a new importer so the importer limit never blocks a reset. */
  freshImporter: boolean;
  log: (msg: string) => void;
}

export interface SeededDeal {
  name: 'venue' | 'shipping' | 'late';
  dealId: string;
  state: string;
  shareToken: string;
  shareIssuer: string;
  assetCode: string;
  cost: string;
  security: string;
  listingFingerprintHex: string;
  txs: Record<string, string | null>;
}

export interface SeedResult {
  network: string;
  instance: DeploymentInstance;
  contractId: string;
  tag: string;
  importer: string;
  supplier: string;
  investors: { coinvest: string; a: string; b: string };
  deals: SeededDeal[];
  seededAt: string;
}

const FRIENDBOT = 'https://friendbot.stellar.org';

async function friendbot(pub: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(pub)}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot ${res.status} for ${pub}`);
}

/** Ensures a demo G key exists in .env, is funded with XLM, holds a qUSD trustline and at least `minQusd`. */
async function ensureDemoAccount(
  envKey: string,
  minQusd: bigint,
  log: (m: string) => void,
  forceNew = false,
): Promise<Keypair> {
  let secret = forceNew ? undefined : readEnvValue(envKey);
  let kp: Keypair;
  if (!secret) {
    kp = Keypair.random();
    await friendbot(kp.publicKey());
    setEnvValues({ [envKey]: kp.secret() });
    log(`${envKey}: new account ${kp.publicKey()} funded by friendbot`);
  } else {
    kp = Keypair.fromSecret(secret);
  }
  const ctx = qusdContext(loadChainEnv({ reload: true }));
  const asset = new Asset(ctx.env.SETTLEMENT_TOKEN_CODE, requireEnv(ctx.env, 'SETTLEMENT_TOKEN_ISSUER'));
  await ensureTrustline(kp, asset, ctx);
  if (minQusd > 0n) {
    const bal = await qusdBalance(kp.publicKey(), ctx);
    if (bal < minQusd) {
      await faucetSend({ to: kp.publicKey(), amount: minQusd - bal }, ctx);
      log(`${envKey}: topped up to ${minQusd / ONE} qUSD`);
    }
  }
  return kp;
}

function b32(hex: string): Buffer {
  const b = Buffer.from(hex, 'hex');
  if (b.length !== 32) throw new Error('expected 32 bytes');
  return b;
}

const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');

export async function seedDeals(opts: SeedOptions): Promise<SeedResult> {
  const { log } = opts;
  const env = loadChainEnv({ reload: true });
  const cfg = networkConfig(env);
  if (cfg.network === 'mainnet') throw new Error('seed never runs on mainnet');
  const dep = loadDeployment(opts.instance, cfg.network);
  const contractId = dep.contractId;
  const now = BigInt(Math.floor(Date.now() / 1000));
  log(`contract ${contractId} (${opts.instance}), tag ${opts.tag}`);

  // Accounts.
  const importer = await ensureDemoAccount('DEMO_IMPORTER_SECRET', 25_000n * ONE, log, opts.freshImporter);
  const supplier = await ensureDemoAccount('DEMO_SUPPLIER_SECRET', 0n, log);
  const investorA = await ensureDemoAccount('DEMO_INVESTOR_A_SECRET', 50_000n * ONE, log);
  const investorB = await ensureDemoAccount('DEMO_INVESTOR_B_SECRET', 50_000n * ONE, log);
  const coinvest = Keypair.fromSecret(requireEnv(env, 'COINVEST_SECRET'));
  const admin = adminClient(env, contractId);
  for (const inv of [coinvest, investorA, investorB]) {
    const r = await ensureInvestorApproved(admin, inv.publicKey());
    if (r) log(`approve_investor ${inv.publicKey()}`);
  }
  const importerC = clientFor(importer.secret(), env, contractId);
  const coinvestC = clientFor(coinvest.secret(), env, contractId);
  const aC = clientFor(investorA.secret(), env, contractId);
  const bC = clientFor(investorB.secret(), env, contractId);
  const attestCtx = { contractId, passphrase: cfg.passphrase, verifierSecret: requireEnv(env, 'VERIFIER_ED25519_SECRET') };
  const coinvestBps = BigInt(env.COINVEST_BPS);

  // Venue deal deadline: Mon 26 Oct 2026 12:00 WET (UTC+0 after the DST change), or 2 h from now.
  const venueDeadline = BigInt(Math.max(Math.floor(Date.UTC(2026, 9, 26, 12, 0, 0) / 1000), Number(now) + 7_200));

  interface Plan {
    name: SeededDeal['name'];
    cost: bigint;
    markupBps: bigint;
    feeBps: bigint;
    lateFeeBps: bigint;
    fundingDeadline: bigint;
    tenor: bigint;
    acceptWindow: bigint;
    target: 'listed' | 'deposit_paid' | 'owned';
  }
  const plans: Plan[] = [
    { name: 'venue', cost: 2_000n * ONE, markupBps: 800n, feeBps: 200n, lateFeeBps: 100n, fundingDeadline: venueDeadline, tenor: 7n * 86_400n, acceptWindow: 7n * 86_400n, target: 'listed' },
    { name: 'shipping', cost: 10_000n * ONE, markupBps: 800n, feeBps: 200n, lateFeeBps: 50n, fundingDeadline: now + 7n * 86_400n, tenor: 30n * 86_400n, acceptWindow: 7n * 86_400n, target: 'deposit_paid' },
    { name: 'late', cost: 5_000n * ONE, markupBps: 800n, feeBps: 200n, lateFeeBps: 100n, fundingDeadline: now + 86_400n, tenor: 120n, acceptWindow: 86_400n, target: 'owned' },
  ];

  const deals: SeededDeal[] = [];
  for (const p of plans) {
    const txs: Record<string, string | null> = {};
    const bps = (v: bigint, b: bigint) => (v * b) / 10_000n;
    const listingFp = hashCanonical({ demo: true, tag: opts.tag, deal: p.name, instance: opts.instance });
    const promiseText = `I promise to buy the goods of demo deal ${p.name} (${opts.tag}) at cost plus the disclosed markup once Qafila owns them; my security deposit follows the Qafila promise terms v1.`;
    const promiseHash = sha256(promiseText);
    const reportHash = hashCanonical({ demo_report: p.name, tag: opts.tag, decision: 'approve' });

    // Security deposit from the on-chain rule.
    const security = await view(await admin.client.required_security({ importer: importer.publicKey(), cost: p.cost }));
    log(`${p.name}: required security ${security / ONE} qUSD`);
    const promised = await call(importerC, (c) =>
      c.promise_purchase({
        importer: importer.publicKey(),
        listing_fingerprint: Buffer.from(listingFp),
        promise_hash: Buffer.from(promiseHash),
        security,
      }),
    );
    txs.promise = promised.hash ?? null;

    // Share token with admin = the contract (PLAN 3.1), code QF + next deal id.
    const roles = await view(await admin.client.get_roles());
    const dealNumber = Number(roles.next_deal_id);
    const share = await createShareToken({ dealNumber, adminContractId: contractId, env, onStep: (s, d) => log(`${p.name}: factory ${s} ${d}`) });
    Object.assign(txs, Object.fromEntries(Object.entries(share.txs).map(([k, v]) => [`factory_${k}`, v])));

    const terms: DealTerms = {
      importer: importer.publicKey(),
      supplier: supplier.publicKey(),
      share_token: share.sacId,
      payout_token: dep.settlementToken.id,
      cost: p.cost,
      deposit_bps: 3000,
      markup: bps(p.cost, p.markupBps),
      platform_fee: bps(p.cost, p.feeBps),
      late_fee: bps(p.cost, p.lateFeeBps),
      funding_deadline: p.fundingDeadline,
      accept_window_secs: p.acceptWindow,
      tenor_secs: p.tenor,
      listing_fingerprint: Buffer.from(listingFp),
      report_hash: Buffer.from(reportHash),
      promise_hash: Buffer.from(promiseHash),
      halal_ok: true,
      payment_mode: { tag: 'Native', values: undefined },
      security,
    };
    const att = signList(terms, attestCtx);
    const listed = await call(admin, (c) => c.list_deal({ terms, sig: att.sig }));
    const dealId = listed.result;
    txs.list = listed.hash ?? null;
    log(`${p.name}: listed as deal ${dealId} ${explorerTxUrl(cfg.network, listed.hash ?? '') ?? ''}`);

    // 5 % co-invest, then the demo investors for funded deals.
    const coAmount = bps(p.cost, coinvestBps);
    const co = await call(coinvestC, (c) => c.invest({ investor: coinvest.publicKey(), deal_id: dealId, amount: coAmount }));
    txs.coinvest = co.hash ?? null;
    let state = 'Listed';
    if (p.target !== 'listed') {
      const rest = p.cost - coAmount;
      const half = rest / 2n;
      const ia = await call(aC, (c) => c.invest({ investor: investorA.publicKey(), deal_id: dealId, amount: half }));
      const ib = await call(bC, (c) => c.invest({ investor: investorB.publicKey(), deal_id: dealId, amount: rest - half }));
      txs.investA = ia.hash ?? null;
      txs.investB = ib.hash ?? null;
      const dep1 = await call(admin, (c) => c.pay_supplier_deposit({ caller: admin.keypair.publicKey(), deal_id: dealId }));
      txs.deposit = dep1.hash ?? null;
      state = 'DepositPaid';
      log(`${p.name}: funded, supplier deposit ${dep1.result / ONE} qUSD paid`);
      if (p.target === 'owned') {
        const blFp = shipmentFingerprint({ carrier: 'MAEU', blNumber: `DEMO-${opts.tag}-${p.name}`, containers: ['MSKU9070323'] });
        const blReport = hashCanonical({ demo_shipment_report: p.name, tag: opts.tag, vessel: 'MAERSK KENTUCKY', pol: 'CNSHA', pod: 'NGAPP' });
        const shipped = signShipped(dealId, blFp, blReport, attestCtx);
        const conf = await call(admin, (c) =>
          c.confirm_shipment({
            caller: admin.keypair.publicKey(),
            deal_id: dealId,
            bl_fingerprint: Buffer.from(blFp),
            bl_report_hash: Buffer.from(blReport),
            sig: shipped.sig,
          }),
        );
        txs.confirm = conf.hash ?? null;
        state = 'Owned';
        log(`${p.name}: shipment confirmed, balance ${conf.result / ONE} qUSD paid; importer can sign the sale`);
      }
    }
    deals.push({
      name: p.name,
      dealId: dealId.toString(),
      state,
      shareToken: share.sacId,
      shareIssuer: share.issuer,
      assetCode: share.assetCode,
      cost: p.cost.toString(),
      security: security.toString(),
      listingFingerprintHex: hex(listingFp),
      txs,
    });
  }

  const result: SeedResult = {
    network: cfg.network,
    instance: opts.instance,
    contractId,
    tag: opts.tag,
    importer: importer.publicKey(),
    supplier: supplier.publicKey(),
    investors: { coinvest: coinvest.publicKey(), a: investorA.publicKey(), b: investorB.publicKey() },
    deals,
    seededAt: new Date().toISOString(),
  };
  const dir = resolve(repoRoot(), 'deployments');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, opts.instance === 'main' ? `seed-${cfg.network}.json` : `seed-${cfg.network}-${opts.instance}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  log(`wrote ${file}`);
  return result;
}

/** Marks a SignedClient's key for callers that need its public key. */
export function publicKeyOf(c: SignedClient): string {
  return c.keypair.publicKey();
}
