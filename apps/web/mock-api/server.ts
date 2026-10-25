/**
 * Mock API for the web app (PLAN 8.1 routes) on port 8788. Schema-valid, realistic data for
 * the three demo deals and more; stateful so every flow can be walked end to end offline.
 * Labelled "mock" in logs and in responses where a real transaction would exist.
 *
 *   pnpm --filter ./apps/web mock-api
 *
 * Real pieces when .env has them: the faucet transfers testnet qUSD (FAUCET_SECRET), and
 * GET /config serves the real network, token and smart-account values.
 */
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { StrKey } from '@stellar/stellar-sdk';
import type { ZodType } from 'zod';
import {
  ABORT_REASONS,
  AbortRequest,
  CreateDealRequest,
  DEAL_STATES,
  DealDetailSchema,
  DealSummarySchema,
  FEATURE_FLAGS,
  HealthSchema,
  JobStatusSchema,
  KycRequest,
  ONE,
  PromiseResponse,
  PublicConfigSchema,
  RegisterDocumentRequest,
  ShipmentRequest,
  StatsSchema,
  TrackingSnapshotSchema,
  WalletLinkRequest,
  renderPromiseText,
  requiredSecurity,
  type AbortReason,
  type DealDetail,
  type DealSummary,
  type OnchainDeal,
  type PublicConfig,
} from '@qafila/shared';
import {
  AgentLogSchema,
  CharityLedgerSchema,
  CreateDealResponseSchema,
  EventFeedSchema,
  ExtendRequest,
  ExtensionRequest,
  FaucetResponseSchema,
  ImporterDealDetailSchema,
  ImporterDealSchema,
  JoinRequest,
  KybRequest,
  KycQueueSchema,
  KycResponseSchema,
  MeSchema,
  NoteRequest,
  OkSchema,
  OpsActionResponseSchema,
  OpsDealDetailSchema,
  OpsQueueItemSchema,
  OverrideRequest,
  PolicySchema,
  PolicyUpdateRequest,
  PortfolioSchema,
  PurchaseOrderSchema,
  RecoveryRequest,
  RegisterDocumentResponseSchema,
  ReportResponseSchema,
  ShipmentResponseSchema,
  TradeFileSchema,
  TxSubmittedRequest,
  UpdateDealTermsRequest,
  VerifyResponseSchema,
  type ImporterDeal,
  type ImporterStage,
  type Me,
  type OpsQueueItem,
} from '../lib/api/schemas';
import { sendFaucet } from './faucet.js';
import { relayerApp } from './relayer.js';
import { approveInvestorOnchain, chainReader, readDealOnchain, readSeed } from './chain.js';
import {
  COINVEST_BPS,
  CONTRACT_CFG,
  ENTITY_NAME,
  PROMISE_VERSION,
  SECURITY_CFG,
  acceptSale,
  buildReport,
  confirmShipment,
  ev,
  investAt,
  makeWorld,
  mockTracking,
  pay,
  payDeposit,
  type MockDeal,
  type MockUser,
  type World,
} from './data.js';
import { DAY, HOUR, ROOT, SHARED, fakeC, fakeG, fakeTx, iso, loadDotEnv, nowIso, nowSecs, randomUuid, readJson, sha256hex } from './util.js';

const env = { ...loadDotEnv(), ...process.env } as Record<string, string | undefined>;
const PORT = Number(env['MOCK_API_PORT'] ?? 8788);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const world: World = makeWorld();

/**
 * Align the three demo deals with Track A's testnet seed when it exists: real on-chain ids,
 * share tokens, issuers, fingerprints and transaction hashes, so every link on the public deal
 * page points at a real transaction while the real API is still being built.
 */
const seed = readSeed();
if (seed) {
  const byName: Record<string, number> = { venue: 1, shipping: 2, late: 3 };
  for (const sd of seed.deals) {
    const d = world.deals.find((x) => x.number === byName[sd.name]);
    if (!d) continue;
    d.onchainId = Number(sd.dealId);
    d.shareToken = sd.shareToken;
    d.issuerPublicKey = sd.shareIssuer;
    d.supplier.payoutAddress = seed.supplier;
    d.importer = d.importer ?? null;
    if (d.promise) {
      d.promise.listingFingerprint = sd.listingFingerprintHex;
      if (sd.txs['promise']) d.promise.txHash = sd.txs['promise'];
    }
    d.listingTxHashes = {
      issuer_created: sd.txs['factory_createIssuer'] ?? d.listingTxHashes['issuer_created']!,
      flags_set: sd.txs['factory_setFlags'] ?? d.listingTxHashes['flags_set']!,
      sac_deployed: sd.txs['factory_deploySac'] ?? d.listingTxHashes['sac_deployed']!,
      admin_set: sd.txs['factory_setAdmin'] ?? d.listingTxHashes['admin_set']!,
      issuer_locked: sd.txs['factory_lockIssuer'] ?? d.listingTxHashes['issuer_locked']!,
      list_deal: sd.txs['list'] ?? d.listingTxHashes['list_deal']!,
    };
    const map: Record<string, string | undefined> = { promised: sd.txs['promise'], deal_listed: sd.txs['list'], deposit_paid: sd.txs['deposit'], shipment_confirmed: sd.txs['confirm'] };
    for (const e of d.timeline) {
      const h = map[e.type];
      if (h) e.txHash = h;
    }
    // Replace the fabricated investors with the seed's real ones (coinvest 5%, investors A and B).
    d.holders.clear();
    d.investTx.clear();
    d.timeline = d.timeline.filter((e) => e.type !== 'invested' && e.type !== 'funded');
    const coin = (d.terms.cost * BigInt(COINVEST_BPS)) / 10000n;
    const realInvestors: Array<[string, bigint, string | undefined]> = [[seed.investors['coinvest'] ?? fakeG('coinvest'), coin, sd.txs['coinvest']]];
    if (sd.txs['investA'] && sd.txs['investB']) {
      const rest = d.terms.cost - coin;
      realInvestors.push([seed.investors['a'] ?? fakeG('a'), rest / 2n, sd.txs['investA']], [seed.investors['b'] ?? fakeG('b'), rest - rest / 2n, sd.txs['investB']]);
    }
    d.funded = 0n;
    let at = d.listedAt + 60;
    for (const [who, amt, tx] of realInvestors) {
      investAt(d, who, amt, at, 1_980_000);
      if (tx) {
        d.investTx.set(who, { txHash: tx, at: iso(at) });
        const e = d.timeline[d.timeline.length - 1];
        if (e && e.type === 'invested') e.txHash = tx;
        else {
          const f = [...d.timeline].reverse().find((x) => x.type === 'invested' && x.data['investor'] === who);
          if (f) f.txHash = tx;
        }
      }
      at += 3 * HOUR;
    }
    if (d.state !== 'Listed' && d.funded >= d.terms.cost) d.state = d.state === 'Funded' ? 'Funded' : d.state;
    for (const p of d.payments) {
      if (p.kind === 'security_locked' && sd.txs['promise']) p.txHash = sd.txs['promise'];
      if (p.kind === 'supplier_deposit' && sd.txs['deposit']) p.txHash = sd.txs['deposit'];
      if (p.kind === 'supplier_balance' && sd.txs['confirm']) p.txHash = sd.txs['confirm'];
    }
    d.audit = d.audit.map((a) => (a.action === 'list_deal' && sd.txs['list'] ? { ...a, txHash: sd.txs['list'] } : a));
  }
  log(`[mock] aligned demo deals with the testnet seed ${seed.contractId} (${seed.seededAt})`);
}


// ------------------------------------------------------------------ helpers

class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 501,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function reply<T>(c: Context, schema: ZodType<T>, data: unknown, status = 200) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    log(`[mock] response failed validation on ${c.req.method} ${c.req.path}: ${JSON.stringify(parsed.error.issues.slice(0, 5))}`);
    return c.json({ error: { code: 'response_invalid', message: 'mock response failed validation', details: parsed.error.issues } }, 500);
  }
  return c.json(parsed.data, status as 200);
}

async function body<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, 'invalid_body', 'request body is invalid', parsed.error.issues);
  return parsed.data;
}

const s = (n: bigint) => n.toString();
const money = (n: bigint) => `${Number(n / ONE).toLocaleString('en-US')} test dollars`;

function who(c: Context): string | null {
  const auth = c.req.header('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    // Mock sessions: the token is "mock.<address>" (see lib/session.ts). Real tokens are Track B's JWTs.
    if (token.startsWith('mock.')) return token.slice(5);
  }
  return c.req.header('x-wallet-address') ?? null;
}

function requireUser(c: Context): MockUser {
  const addr = who(c);
  if (!addr) throw new HttpError(401, 'unauthenticated', 'Connect a wallet first.');
  return ensureUser(addr);
}

function ensureUser(address: string): MockUser {
  let u = world.users.get(address);
  if (!u) {
    u = { address, displayName: null, email: null, country: null, kycStatus: 'none', investorApproved: false, approveTxHash: null, joinedVia: null, createdAt: nowIso(), importer: null, faucetTaken: false };
    world.users.set(address, u);
    world.walletsCreated += 1;
  }
  return u;
}

/**
 * The wallet that opens the importer area owns the seven seeded demo deals (mock only), so any
 * demo wallet can walk the importer flows. Deals created through POST /deals keep their creator.
 * The cancelled deal's refund follows the demo importer.
 */
const SEEDED_NUMBERS = new Set([1, 2, 3, 4, 5, 6, 7]);
function bindDemoImporter(address: string) {
  if (world.demoImporter === address) return;
  const previous = world.demoImporter;
  world.demoImporter = address;
  for (const d of world.deals) if (SEEDED_NUMBERS.has(d.number)) d.importer = address;
  if (previous) {
    const owed = world.refunds.get(previous) ?? 0n;
    if (owed > 0n) {
      world.refunds.set(previous, 0n);
      world.refunds.set(address, (world.refunds.get(address) ?? 0n) + owed);
    }
  }
  const u = ensureUser(address);
  if (!u.importer) {
    u.importer = { legalName: 'Amina Trading Ltd', country: 'NG', registrationNumber: 'RC-1736620', kybStatus: 'approved', documents: [], faucetGrant: null, submittedAt: iso(nowSecs() - 3 * DAY) };
    u.displayName = u.displayName ?? 'Amina';
    u.country = u.country ?? 'NG';
  }
  log(`[mock] demo importer deals now belong to ${address}`);
}

/** First wallet that opens the portfolio inherits the demo positions (mock only). */
function bindDemoInvestor(address: string) {
  if (world.demoInvestor) return;
  world.demoInvestor = address;
  const from = [fakeC('wallet-a'), fakeC('wallet-1')];
  for (const d of world.deals) {
    for (const f of from) {
      const sh = d.holders.get(f);
      if (sh !== undefined) {
        d.holders.delete(f);
        d.holders.set(address, (d.holders.get(address) ?? 0n) + sh);
        const tx = d.investTx.get(f);
        if (tx) d.investTx.set(address, tx);
        const cl = d.claimed.get(f);
        if (cl) d.claimed.set(address, cl);
        for (const e of d.timeline) if (e.data['investor'] === f) e.data['investor'] = address;
        for (const e of d.timeline) if (e.data['holder'] === f) e.data['holder'] = address;
      }
    }
    d.holderCount = d.holders.size;
  }
  const u = ensureUser(address);
  u.investorApproved = true;
  u.kycStatus = 'approved';
  u.approveTxHash = u.approveTxHash ?? fakeTx();
  log(`[mock] bound demo investor positions to ${address}`);
}

function findDeal(idOrNumber: string): MockDeal {
  const d = world.deals.find((x) => x.id === idOrNumber || String(x.number) === idOrNumber || (x.onchainId !== null && `onchain-${x.onchainId}` === idOrNumber));
  if (!d) throw new HttpError(404, 'deal_not_found', 'This deal does not exist.');
  return d;
}
function findByOnchain(id: number): MockDeal {
  const d = world.deals.find((x) => x.onchainId === id);
  if (!d) throw new HttpError(404, 'deal_not_found', `No deal with on-chain id ${id}.`);
  return d;
}

function touch(d: MockDeal) {
  d.updatedAt = nowIso();
  d.timeline.sort((a, b) => a.at.localeCompare(b.at));
}

const ledger = () => 1_980_000 + Math.floor((Date.now() / 1000 - 1_761_400_000) / 5);

// ------------------------------------------------------------------ config

function deploymentContractId(): string | null {
  const fromEnv = env['QAFILA_CONTRACT_ID'];
  if (fromEnv) return fromEnv;
  const shared = readJson<{ contractId?: string; qafilaContractId?: string }>(`${SHARED}/testnet.json`) ?? readJson<{ contractId?: string; qafilaContractId?: string }>(`${ROOT}/deployments/testnet.json`);
  return shared?.contractId ?? shared?.qafilaContractId ?? null;
}

function verifierHex(): string | null {
  const acc = readJson<{ roles?: { verifier?: { stellarPublic?: string } } }>(`${SHARED}/accounts.json`);
  const g = acc?.roles?.verifier?.stellarPublic;
  if (!g) return null;
  try {
    return Buffer.from(StrKey.decodeEd25519PublicKey(g)).toString('hex');
  } catch {
    return null;
  }
}

function publicConfig(): PublicConfig {
  const network = (env['STELLAR_NETWORK'] as PublicConfig['network'] | undefined) ?? 'testnet';
  return {
    network,
    rpcUrl: env['STELLAR_RPC_URL'] ?? 'https://soroban-testnet.stellar.org',
    horizonUrl: env['HORIZON_URL'] ?? 'https://horizon-testnet.stellar.org',
    networkPassphrase: env['NETWORK_PASSPHRASE'] ?? 'Test SDF Network ; September 2015',
    contractId: deploymentContractId(),
    settlementToken: { id: env['SETTLEMENT_TOKEN_ID'] ?? null, code: env['SETTLEMENT_TOKEN_CODE'] ?? 'qUSD', issuer: env['SETTLEMENT_TOKEN_ISSUER'] ?? null, label: network === 'mainnet' ? 'USDC' : 'test dollars' },
    x402UsdcTokenId: env['X402_USDC_TOKEN_ID'] ?? null,
    charityAddress: env['CHARITY_ADDRESS'] ?? fakeG('charity'),
    treasuryAddress: env['TREASURY_ADDRESS'] ?? fakeG('treasury'),
    verifierPublicKey: verifierHex(),
    smartAccount: {
      wasmHash: env['SMART_ACCOUNT_WASM_HASH'] ?? null,
      webauthnVerifier: env['WEBAUTHN_VERIFIER_ADDRESS'] ?? null,
      relayerUrl: env['RELAYER_URL'] ?? null,
      rpId: env['APP_DOMAIN'] ?? 'localhost',
    },
    entityName: env['QAFILA_ENTITY_NAME'] ?? ENTITY_NAME,
    coinvestBps: Number(env['COINVEST_BPS'] ?? COINVEST_BPS),
    flags: Object.fromEntries(FEATURE_FLAGS.map((f) => [f, (env[f] ?? ({ FF_EXTENSIONS: 'true', FF_COINVEST: 'true', FF_X402: 'true', FF_REFLECTOR: 'true', FF_TRADE_PASSPORT: 'true', FF_TRADE_FILE: 'true', FF_QR_JOIN: 'true' } as Record<string, string>)[f] ?? 'false') === 'true'])) as PublicConfig['flags'],
    version: 'mock-0.1.0',
  };
}

const chainEnv = () => ({ contractId: publicConfig().contractId, rpcUrl: publicConfig().rpcUrl, networkPassphrase: publicConfig().networkPassphrase, adminSecret: env['ADMIN_SECRET'] });
const reader = chainReader(chainEnv());

/** Overlay live contract state on a seed-aligned deal (funded, state, repayments) so the UI shows real numbers. */
async function overlay(d: MockDeal): Promise<void> {
  if (!reader || d.onchainId === null || !seed) return;
  const oc = await readDealOnchain(reader, d.onchainId);
  if (!oc) return;
  const stateMap: Record<string, ImporterStage> = { Listed: 'listed', Funded: 'funded', DepositPaid: 'deposit_paid', Owned: 'owned', Sold: 'sold', Repaid: 'repaid', Cancelled: 'cancelled', Defaulted: 'defaulted', Liquidated: 'liquidated', Closed: 'closed' };
  d.state = oc.state as MockDeal['state'];
  d.stage = stateMap[oc.state] ?? d.stage;
  d.funded = oc.funded;
  d.supplierPaid = oc.supplierPaid;
  d.salePrice = oc.salePrice;
  d.principalRepaid = oc.principalRepaid;
  d.dueAt = oc.dueAt;
  d.ownedAt = oc.ownedAt;
  d.acceptedAt = oc.acceptedAt;
  d.lateFeeDue = oc.lateFeeDue;
  d.lateFeePaid = oc.lateFeePaid;
  d.recovered = oc.recovered;
  d.distributable = oc.distributable;
  d.claimedShares = oc.claimedShares;
  d.paidOut = oc.paidOut;
  d.holderCount = Math.max(oc.holderCount, d.holders.size);
  d.securityHeld = oc.security;
  if (oc.listedAt) d.listedAt = oc.listedAt;
}

// ------------------------------------------------------------------ serializers

function onchain(d: MockDeal): OnchainDeal | null {
  if (!d.state || d.onchainId === null) return null;
  return {
    id: d.onchainId,
    terms: {
      importer: d.importer ?? fakeC(`importer-${d.number}`),
      supplier: d.supplier.payoutAddress ?? fakeG(`supplier-${d.number}`),
      share_token: d.shareToken ?? fakeC(`share-${d.number}`),
      payout_token: env['SETTLEMENT_TOKEN_ID'] ?? fakeC('qusd'),
      cost: s(d.terms.cost),
      deposit_bps: d.terms.depositBps,
      markup: s(d.terms.markup),
      platform_fee: s(d.terms.platformFee),
      late_fee: s(d.terms.lateFee),
      funding_deadline: d.terms.fundingDeadline ?? d.listedAt + 7 * DAY,
      accept_window_secs: d.terms.acceptWindowSecs,
      tenor_secs: d.terms.tenorSecs,
      listing_fingerprint: d.promise?.listingFingerprint ?? sha256hex(`fp-${d.id}`),
      report_hash: d.report?.reportHash ?? sha256hex(`rh-${d.id}`),
      promise_hash: d.promise?.textHash ?? sha256hex(`ph-${d.id}`),
      halal_ok: true,
      payment_mode: 'Native',
      security: s(d.terms.security),
    },
    state: d.state,
    listed_at: d.listedAt,
    funded: s(d.funded),
    supplier_paid: s(d.supplierPaid),
    owned_at: d.ownedAt,
    bl_fingerprint: d.blFingerprint,
    bl_report_hash: d.blReportHash,
    sale_price: s(d.salePrice),
    accepted_at: d.acceptedAt,
    due_at: d.dueAt,
    principal_repaid: s(d.principalRepaid),
    late_fee_due: s(d.lateFeeDue),
    late_fee_paid: s(d.lateFeePaid),
    recovered: s(d.recovered),
    distributable: s(d.distributable),
    claimed_shares: s(d.claimedShares),
    paid_out: s(d.paidOut),
    holder_count: d.holderCount,
    security: s(d.securityHeld),
    importer_at_fault: d.importerAtFault,
    extended: d.extended,
  };
}

function statusText(d: MockDeal): string {
  if (d.state) return d.state;
  return { draft: 'Draft', verifying: 'Screening', review: 'Needs review', rejected: 'Rejected', approved: 'Approved', promised: 'Promise signed' }[d.stage as string] ?? d.stage;
}

function summary(d: MockDeal): DealSummary {
  return {
    id: d.id,
    number: d.number,
    onchainId: d.onchainId,
    status: statusText(d),
    state: d.state,
    goodsSummary: d.goodsSummary,
    route: d.route,
    cost: s(d.terms.cost),
    markup: s(d.terms.markup),
    platformFee: s(d.terms.platformFee),
    security: s(d.terms.security),
    tenorSecs: d.terms.tenorSecs,
    funded: s(d.funded),
    fundingDeadline: d.terms.fundingDeadline,
    decision: d.decision,
    riskScore: d.riskScore,
    importerHistory: d.importerStats,
    shareToken: d.shareToken,
    createdAt: d.createdAt,
  };
}

function detail(d: MockDeal): DealDetail {
  const bps = d.terms.cost > 0n ? Number((d.terms.security * 10000n) / d.terms.cost) : 0;
  return {
    ...summary(d),
    onchain: onchain(d),
    publicReport: d.report
      ? {
          stage: d.report.stage,
          decision: d.report.decision,
          riskScore: d.report.riskScore,
          reportHash: d.report.reportHash,
          signature: d.report.signature,
          checks: d.report.report.checks.map((c) => ({ name: c.name, status: c.status, severity: c.severity, detail: c.detail })),
          adapterModes: d.report.report.adapter_modes,
          createdAt: d.report.createdAt,
        }
      : null,
    tracking: d.tracking,
    timeline: d.timeline.map(({ txHash, ledger: l, type, data, at }) => ({ txHash, ledger: l, type, data, at })),
    payments: d.payments,
    issuer: d.issuerPublicKey ? { publicKey: d.issuerPublicKey, locked: true, flags: ['AUTH_REQUIRED', 'AUTH_REVOCABLE', 'AUTH_CLAWBACK_ENABLED'] } : null,
    escrowId: null,
    lossOrder: [
      "The importer's own money: the security deposit, and after the sale everything they have paid.",
      'Recoveries: from the supplier, insurance, resale of the goods, legal collection.',
      `Investors pro rata, Qafila's own ${COINVEST_BPS / 100}% included.`,
    ],
    worstCase: {
      investorRecoveryBps: bps,
      note: `If the importer pays nothing after buying and nothing is recovered, holders get back the deposit's share: ${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}% of what they put in.`,
    },
  };
}

function nextAction(d: MockDeal): string {
  switch (d.stage) {
    case 'draft':
      return d.documents.filter((x) => x.stage === 'listing').length < 3 ? 'Upload the invoice, packing list and supplier licence' : 'Run screening';
    case 'verifying':
      return 'Screening is running';
    case 'review':
      return 'Fix the flagged document and run screening again';
    case 'rejected':
      return 'This deal cannot go ahead with these documents';
    case 'approved':
      return 'Sign the purchase promise and lock your security deposit';
    case 'promised':
      return 'Waiting for ops to list the deal';
    case 'listed':
      return 'Funding in progress';
    case 'funded':
      return 'Waiting for the supplier deposit';
    case 'deposit_paid':
      return d.shipment ? 'Waiting for the agent to confirm the shipment' : 'Upload the bill of lading when the goods ship';
    case 'owned':
      return 'Sign the sale at the fixed price';
    case 'sold':
      return d.principalRepaid < d.salePrice ? 'Repay by the due date' : 'Repaid';
    case 'repaid':
      return d.lateFeeDue > d.lateFeePaid ? 'Pay the late fee to charity' : 'Done';
    case 'cancelled':
      return (world.refunds.get(d.importer ?? '') ?? 0n) > 0n ? 'Collect your security deposit' : 'Closed';
    default:
      return 'Nothing to do';
  }
}

function importerDeal(d: MockDeal): ImporterDeal {
  const refund = d.importer ? (world.refunds.get(d.importer) ?? 0n) : 0n;
  return {
    ...summary(d),
    stage: d.stage,
    nextAction: nextAction(d),
    supplier: { nameEn: d.supplier.nameEn, nameZh: d.supplier.nameZh, uscc: d.supplier.uscc, payoutAddress: d.supplier.payoutAddress, confirmed: d.supplier.confirmed },
    terms: { cost: s(d.terms.cost), markup: s(d.terms.markup), platformFee: s(d.terms.platformFee), lateFee: s(d.terms.lateFee), depositBps: d.terms.depositBps, tenorSecs: d.terms.tenorSecs, acceptWindowSecs: d.terms.acceptWindowSecs, fundingDeadline: d.terms.fundingDeadline },
    documents: d.documents,
    reportSummary: d.report ? { decision: d.report.decision, riskScore: d.report.riskScore, explanation: d.report.explanation, fixCount: d.report.fixes.length, createdAt: d.report.createdAt } : null,
    promise: d.promise ? { textHash: d.promise.textHash, listingFingerprint: d.promise.listingFingerprint, security: s(d.promise.security), securityBps: d.promise.securityBps, txHash: d.promise.txHash, signedAt: d.promise.signedAt, withdrawable: d.promise.txHash !== null && d.state === null, text: d.promise.text } : null,
    shipment: d.shipment,
    refundOwed: s(refund),
    extension: d.extension,
  };
}

function opsQueueItem(d: MockDeal): OpsQueueItem {
  let pending: OpsQueueItem['pendingAction'] = null;
  const now = nowSecs();
  if (d.stage === 'review') pending = 'review_report';
  else if (d.stage === 'promised') pending = 'list';
  else if (d.stage === 'funded') pending = 'pay_deposit';
  else if (d.stage === 'deposit_paid' && d.shipment) pending = 'confirm_shipment';
  else if (d.stage === 'sold' && !d.blReleasedAt) pending = 'release_bl';
  else if (d.stage === 'sold' && d.extension?.decision === 'pending') pending = 'extension';
  else if (d.stage === 'sold' && now > d.dueAt + CONTRACT_CFG.grace_secs && d.principalRepaid < d.salePrice) pending = 'mark_default';
  else if (d.stage === 'defaulted') pending = 'finalize';
  return { ...summary(d), importerName: d.importerLegalName, supplierName: d.supplier.nameEn, stage: d.stage, pendingAction: pending, openIncidents: d.incidents.filter((i) => i.status === 'open').length, updatedAt: d.updatedAt };
}

function opsDetail(d: MockDeal) {
  const u = d.importer ? world.users.get(d.importer) : undefined;
  return {
    ...detail(d),
    ...importerDeal(d),
    importer: {
      displayName: u?.displayName ?? d.importerName,
      legalName: u?.importer?.legalName ?? d.importerLegalName,
      country: u?.importer?.country ?? d.route.destinationCountry,
      registrationNumber: u?.importer?.registrationNumber ?? 'RC-1736620',
      kybStatus: u?.importer?.kybStatus ?? 'approved',
      walletAddress: d.importer,
      stats: d.importerStats,
      limit: s(BigInt(CONTRACT_CFG.base_importer_limit) + BigInt(CONTRACT_CFG.limit_step) * BigInt(d.importerStats.on_time)),
    },
    listing: d.shareToken ? { shareToken: d.shareToken, issuerPublicKey: d.issuerPublicKey, txHashes: d.listingTxHashes } : null,
    audit: d.audit,
    incidents: d.incidents,
    agentActions: d.agentActions,
    recoveries: d.recoveries.map((r) => ({ ...r, amount: s(r.amount) })),
    recoveryNotes: d.recoveryNotes,
    abort: d.abort,
    blReleasedAt: d.blReleasedAt,
  };
}

function me(u: MockUser): Me {
  const onTime = u.importer ? 0 : 0;
  return {
    profile: {
      id: sha256hex(u.address).slice(0, 16),
      displayName: u.displayName,
      email: u.email,
      country: u.country,
      roles: ['investor', 'importer', 'ops', 'sharia'],
      walletAddress: u.address,
      walletKind: u.address.startsWith('C') ? 'smart_account' : 'g_account',
      kycStatus: u.kycStatus,
      joinedVia: u.joinedVia,
      createdAt: u.createdAt,
    },
    investorApproved: u.investorApproved,
    investorApproveTxHash: u.approveTxHash,
    importer: u.importer
      ? {
          legalName: u.importer.legalName,
          country: u.importer.country,
          registrationNumber: u.importer.registrationNumber,
          kybStatus: u.importer.kybStatus,
          limit: CONTRACT_CFG.base_importer_limit,
          openExposure: s(world.deals.filter((d) => d.importer === u.address && d.state && !['Repaid', 'Cancelled', 'Liquidated', 'Closed'].includes(d.state)).reduce((a, d) => a + d.terms.cost, 0n)),
          nextSecurityBps: Math.max(SECURITY_CFG.securityFloorBps, SECURITY_CFG.minSecurityBps - onTime * SECURITY_CFG.securityStepBps),
          stats: { on_time: onTime, late: 0, defaulted: 0, total_repaid: '0', open_exposure: '0' },
          faucetGrant: u.importer.faucetGrant ? { amount: s(u.importer.faucetGrant.amount), txHash: u.importer.faucetGrant.txHash } : null,
        }
      : null,
  };
}

// ------------------------------------------------------------------ chain-like mutations (used by /mock/chain and by routes)

function doInvest(d: MockDeal, investor: string, amount: bigint): string {
  if (d.state !== 'Listed') throw new HttpError(409, 'InvalidState', 'This deal is not open for funding.');
  if (d.terms.fundingDeadline && nowSecs() > d.terms.fundingDeadline) throw new HttpError(409, 'FundingClosed', 'The funding deadline has passed.');
  const left = d.terms.cost - d.funded;
  if (amount <= 0n || amount > left) throw new HttpError(409, 'ExceedsRemaining', `Only ${money(left)} is left to fund.`);
  const u = ensureUser(investor);
  if (!u.investorApproved) throw new HttpError(409, 'NotApprovedInvestor', 'Finish sign-up first so your wallet is approved.');
  investAt(d, investor, amount, nowSecs(), ledger());
  touch(d);
  return d.investTx.get(investor)!.txHash;
}

function doPromise(fp: string, importer: string, security: bigint): string {
  const d = world.deals.find((x) => x.promise?.listingFingerprint === fp);
  if (!d) throw new HttpError(404, 'NoPromise', 'No promise text was prepared for this fingerprint.');
  if (d.promise!.txHash) throw new HttpError(409, 'PromiseExists', 'This promise was already signed.');
  if (security !== d.promise!.security) throw new HttpError(409, 'SecurityTooLow', 'The security deposit does not match the promise.');
  const tx = fakeTx();
  d.promise!.txHash = tx;
  d.promise!.signedAt = nowIso();
  d.importer = importer;
  d.stage = 'promised';
  d.timeline.push({ ...ev(d, 'promised', nowSecs(), { importer, security: s(security) }, `Importer signed the purchase promise and locked a security deposit of ${money(security)}`, ledger()), txHash: tx });
  d.payments.push(pay('security_locked', security, nowSecs(), tx));
  touch(d);
  return tx;
}

function doWithdrawPromise(fp: string, importer: string): string {
  const d = world.deals.find((x) => x.promise?.listingFingerprint === fp);
  if (!d || !d.promise?.txHash) throw new HttpError(404, 'NoPromise', 'There is no signed promise to withdraw.');
  if (d.state !== null) throw new HttpError(409, 'PromiseListed', 'The deal is already listed; the promise can no longer be withdrawn.');
  if (d.importer !== importer) throw new HttpError(403, 'NotAuthorized', 'Only the importer can withdraw their promise.');
  const tx = fakeTx();
  const amt = d.promise.security;
  d.promise = null;
  d.stage = 'approved';
  d.timeline.push({ ...ev(d, 'promise_withdrawn', nowSecs(), { importer, amount: s(amt) }, `Promise withdrawn; security deposit of ${money(amt)} returned`, ledger()), txHash: tx });
  d.payments.push(pay('security_refunded', amt, nowSecs(), tx));
  touch(d);
  return tx;
}

function doAccept(d: MockDeal, importer: string): string {
  if (d.state !== 'Owned') throw new HttpError(409, 'InvalidState', 'The deal does not own the goods yet.');
  if (d.importer !== importer) throw new HttpError(403, 'NotAuthorized', 'Only the importer can sign the sale.');
  if (nowSecs() > d.ownedAt + d.terms.acceptWindowSecs) throw new HttpError(409, 'AcceptWindowClosed', 'The window to sign the sale has closed.');
  acceptSale(d, nowSecs(), ledger());
  touch(d);
  return d.timeline[d.timeline.length - 1]!.txHash;
}

function doRepay(d: MockDeal, importer: string, amount: bigint): string {
  if (d.state !== 'Sold') throw new HttpError(409, 'InvalidState', 'Nothing to repay on this deal.');
  if (d.importer !== importer) throw new HttpError(403, 'NotAuthorized', 'Only the importer can repay.');
  const left = d.salePrice - d.principalRepaid;
  if (amount <= 0n || amount > left) throw new HttpError(409, 'ExceedsRemaining', `Only ${money(left)} is left to pay.`);
  const now = nowSecs();
  const tx = fakeTx();
  d.principalRepaid += amount;
  d.payments.push(pay('repayment', amount, now, tx));
  let summaryText = `Importer repaid ${money(amount)}`;
  if (d.principalRepaid === d.salePrice) {
    const late = now > d.dueAt;
    if (late) {
      d.lateFeeDue = d.terms.lateFee;
      d.importerStats.late += 1;
      summaryText += `, after the due date. Investors are paid in full; a late fee of ${money(d.terms.lateFee)} is due to charity`;
    } else if (!d.extended) {
      d.importerStats.on_time += 1;
      summaryText += ', on time';
    }
    d.distributable = d.salePrice - d.terms.platformFee;
    d.state = 'Repaid';
    d.stage = 'repaid';
    d.importerStats.total_repaid = s(BigInt(d.importerStats.total_repaid) + d.salePrice);
  }
  d.timeline.push({ ...ev(d, 'repaid', now, { amount: s(amount), late: now > d.dueAt }, summaryText, ledger()), txHash: tx });
  touch(d);
  return tx;
}

function doLateFee(d: MockDeal, importer: string, amount: bigint): string {
  if (d.state !== 'Repaid' && d.state !== 'Closed') throw new HttpError(409, 'InvalidState', 'No late fee is due on this deal.');
  if (d.importer !== importer) throw new HttpError(403, 'NotAuthorized', 'Only the importer can pay the late fee.');
  const left = d.lateFeeDue - d.lateFeePaid;
  if (amount <= 0n || amount > left) throw new HttpError(409, 'ExceedsRemaining', `The late fee left is ${money(left)}.`);
  const now = nowSecs();
  const tx = fakeTx();
  d.lateFeePaid += amount;
  d.payments.push(pay('late_fee', amount, now, tx));
  d.timeline.push({ ...ev(d, 'late_fee_to_charity', now, { amount: s(amount) }, `Late fee of ${money(amount)} paid and set aside for charity`, ledger()), txHash: tx });
  // The agent sweeps right away (A-3).
  const sweep = fakeTx();
  d.payments.push(pay('sweep', amount, now + 5, sweep));
  d.timeline.push({ ...ev(d, 'swept', now + 5, { to: 'charity', amount: s(amount) }, 'Agent swept the late fee to the charity address', ledger()), txHash: sweep });
  d.agentActions.push({ id: randomUuid(), dealNumber: d.number, action: 'sweep_charity', decision: 'swept', reasoning: 'late_fee_to_charity event seen by the indexer.', txHash: sweep, status: 'done', at: iso(now + 5) });
  world.charity.push({ kind: 'late_fee', amount, txHash: sweep, dealNumber: d.number, at: iso(now + 5) });
  touch(d);
  return tx;
}

function doClaim(d: MockDeal, holder: string): { tx: string; amount: bigint } {
  if (!d.state || !['Repaid', 'Cancelled', 'Liquidated'].includes(d.state)) throw new HttpError(409, 'InvalidState', 'This deal is not ready to claim yet.');
  const shares = d.holders.get(holder) ?? 0n;
  if (shares <= 0n || d.claimed.has(holder)) throw new HttpError(409, 'NothingToClaim', 'There is nothing to claim for this wallet.');
  const payout = (shares * d.distributable) / d.funded;
  const tx = fakeTx();
  d.claimed.set(holder, { amount: payout, txHash: tx });
  d.claimedShares += shares;
  d.paidOut += payout;
  d.payments.push(pay('claim', payout, nowSecs(), tx));
  d.timeline.push({ ...ev(d, 'claimed', nowSecs(), { holder, amount: s(payout) }, `Investor claimed ${money(payout)}`, ledger()), txHash: tx });
  if (d.claimedShares === d.funded) {
    d.state = 'Closed';
    d.stage = 'closed';
    const dust = d.distributable - d.paidOut;
    if (dust > 0n) world.charity.push({ kind: 'dust', amount: dust, txHash: fakeTx(), dealNumber: d.number, at: nowIso() });
    d.timeline.push({ ...ev(d, 'closed', nowSecs() + 1, { deal_id: d.onchainId }, 'Everything claimed; deal closed', ledger()) });
  }
  touch(d);
  return { tx, amount: payout };
}

function doWithdrawRefund(addr: string): { tx: string; amount: bigint } {
  const amt = world.refunds.get(addr) ?? 0n;
  if (amt <= 0n) throw new HttpError(409, 'NothingToRefund', 'There is no refund waiting for this wallet.');
  world.refunds.set(addr, 0n);
  const tx = fakeTx();
  for (const d of world.deals) if (d.importer === addr && d.stage === 'cancelled') d.payments.push(pay('security_refunded', amt, nowSecs(), tx));
  return { tx, amount: amt };
}

function refundSecurity(d: MockDeal, when: number) {
  if (d.securityHeld > 0n && d.importer) {
    world.refunds.set(d.importer, (world.refunds.get(d.importer) ?? 0n) + d.securityHeld);
    d.timeline.push({ ...ev(d, 'refund_owed', when, { importer: d.importer, amount: s(d.securityHeld) }, `Security deposit of ${money(d.securityHeld)} owed back to the importer`, ledger()) });
    d.securityHeld = 0n;
  }
}

// Seed the cancelled deal's refund for whoever becomes the demo importer.
function seedRefundFor(address: string) {
  const d5 = world.deals.find((x) => x.number === 5);
  if (d5 && d5.securityHeld > 0n) {
    world.refunds.set(address, (world.refunds.get(address) ?? 0n) + d5.securityHeld);
    d5.securityHeld = 0n;
  }
}

// ------------------------------------------------------------------ app

const app = new Hono();
app.use('*', cors({ origin: (o) => o ?? '*', allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], maxAge: 600 }));
app.use('*', async (c, next) => {
  const t = Date.now();
  await next();
  log(`[mock] ${c.req.method} ${c.req.path} -> ${c.res.status} ${Date.now() - t}ms`);
});
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  log(`[mock] error on ${c.req.path}: ${err.message}`);
  return c.json({ error: { code: 'internal', message: err.message } }, 500);
});
app.notFound((c) => c.json({ error: { code: 'not_found', message: `No route ${c.req.method} ${c.req.path}` } }, 404));

// --- public
app.get('/health', (c) =>
  reply(c, HealthSchema, { ok: true, time: nowIso(), rpc: { ok: true, latencyMs: 212, protocol: 29 }, db: { ok: true, latencyMs: 3 }, indexerLagSecs: 4, adapters: { llm: 'mock', registry: 'mock', sanctions: 'mock', tracking: 'mock', fx: 'mock', resend: 'off' }, version: 'mock-0.1.0' }),
);
app.get('/config', (c) => reply(c, PublicConfigSchema, publicConfig()));
app.get('/.well-known/qafila-verifier.json', (c) => c.json({ verifierPublicKey: verifierHex(), contractId: deploymentContractId(), network: publicConfig().network, networkPassphrase: publicConfig().networkPassphrase, attestationPrefix: 'QAFILA-ATTEST-V1', purposes: { LIST: 1, SHIPPED: 2, REPORT: 10 } }));

app.get('/stats', (c) => {
  const listed = world.deals.filter((d) => d.state);
  const byState: Record<string, number> = Object.fromEntries(DEAL_STATES.map((st) => [st, 0]));
  for (const d of listed) byState[d.state!] = (byState[d.state!] ?? 0) + 1;
  let profit = 0n;
  for (const d of listed) for (const [h, cl] of d.claimed) profit += cl.amount - (d.holders.get(h) ?? 0n) > 0n ? cl.amount - (d.holders.get(h) ?? 0n) : 0n;
  return reply(c, StatsSchema, {
    walletsCreated: world.walletsCreated,
    approvedInvestors: 29 + [...world.users.values()].filter((u) => u.investorApproved).length,
    dealsByState: byState,
    funded: s(listed.reduce((a, d) => a + d.funded, 0n)),
    profitPaid: s(profit),
    charityTotal: s(world.charity.reduce((a, e) => a + e.amount, 0n)),
    securityLocked: s(world.deals.reduce((a, d) => a + d.securityHeld + (d.stage === 'promised' ? d.promise?.security ?? 0n : 0n), 0n)),
    refundsPaid: s(world.deals.flatMap((d) => d.payments).filter((p) => p.kind === 'security_refunded').reduce((a, p) => a + BigInt(p.amount), 0n)),
    joinedDuringEvent: world.joinedDuringEvent + [...world.users.values()].filter((u) => u.joinedVia === 'hackmeridian').length,
    updatedAt: nowIso(),
  });
});

app.get('/events', (c) => {
  const limit = Math.min(50, Number(c.req.query('limit') ?? 20));
  const all = world.deals.flatMap((d) => d.timeline).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  return reply(c, EventFeedSchema, all);
});

app.get('/charity', (c) =>
  reply(c, CharityLedgerSchema, {
    address: publicConfig().charityAddress,
    total: s(world.charity.reduce((a, e) => a + e.amount, 0n)),
    owed: '0',
    entries: [...world.charity].sort((a, b) => b.at.localeCompare(a.at)).map((e) => ({ ...e, amount: s(e.amount) })),
  }),
);

app.get('/deals', async (c) => {
  const listed = world.deals.filter((d) => d.state !== null).sort((a, b) => b.listedAt - a.listedAt);
  await Promise.all(listed.map(overlay));
  return reply(c, DealSummarySchema.array(), listed.map(summary));
});
app.get('/deals/:id', async (c) => {
  const d = findDeal(c.req.param('id'));
  if (!d.state) throw new HttpError(404, 'deal_not_found', 'This deal is not public yet.');
  await overlay(d);
  return reply(c, DealDetailSchema, detail(d));
});
app.get('/deals/:id/tracking', (c) => {
  const d = findDeal(c.req.param('id'));
  if (!d.tracking) throw new HttpError(404, 'no_tracking', 'Tracking starts when the bill of lading is uploaded.');
  return reply(c, TrackingSnapshotSchema, d.tracking);
});
app.get('/deals/:id/purchase-order', (c) => {
  const d = findDeal(c.req.param('id'));
  return reply(c, PurchaseOrderSchema, { dealNumber: d.number, entityName: ENTITY_NAME, supplierName: d.supplier.nameEn, goodsSummary: d.goodsSummary, cost: s(d.terms.cost), depositBps: d.terms.depositBps, payoutAddress: d.supplier.payoutAddress, status: d.supplier.confirmed ? 'accepted' : 'pending', acceptedAt: d.supplier.confirmed ? d.createdAt : null, signature: null });
});

// --- identity
app.get('/me', (c) => reply(c, MeSchema, me(requireUser(c))));
app.post('/wallet/link', async (c) => {
  const b = await body(c, WalletLinkRequest);
  ensureUser(b.address);
  return reply(c, OkSchema, { ok: true });
});
app.post('/kyc', async (c) => {
  const u = requireUser(c);
  const b = await body(c, KycRequest);
  u.displayName = b.displayName;
  u.country = b.country;
  u.email = b.email ?? null;
  u.kycStatus = 'approved';
  u.investorApproved = true;
  if (!u.approveTxHash) {
    const real = await approveInvestorOnchain(chainEnv(), u.address, log).catch((e: Error) => {
      log(`[mock] approve_investor failed: ${e.message.slice(0, 200)}`);
      return null;
    });
    u.approveTxHash = real ?? fakeTx();
  }
  let faucet: { amount: string; txHash: string } | null = null;
  if (!u.faucetTaken) {
    const r = await sendFaucet({ secret: env['FAUCET_SECRET'], tokenId: env['SETTLEMENT_TOKEN_ID'], rpcUrl: publicConfig().rpcUrl, networkPassphrase: publicConfig().networkPassphrase }, u.address, 50n * ONE, log).catch((e: Error) => {
      log(`[mock] faucet failed: ${e.message}`);
      return null;
    });
    if (r) {
      u.faucetTaken = true;
      faucet = { amount: s(50n * ONE), txHash: r.txHash };
    }
  }
  return reply(c, KycResponseSchema, { kycStatus: 'approved', approveTxHash: u.approveTxHash, faucet });
});
app.post('/join', async (c) => {
  const b = await body(c, JoinRequest);
  const u = ensureUser(b.address);
  u.displayName = b.displayName;
  u.joinedVia = 'hackmeridian';
  u.kycStatus = 'approved';
  u.investorApproved = true;
  if (!u.approveTxHash) {
    const real = await approveInvestorOnchain(chainEnv(), u.address, log).catch(() => null);
    u.approveTxHash = real ?? fakeTx();
  }
  let faucet: { amount: string; txHash: string } | null = null;
  if (!u.faucetTaken) {
    const r = await sendFaucet({ secret: env['FAUCET_SECRET'], tokenId: env['SETTLEMENT_TOKEN_ID'], rpcUrl: publicConfig().rpcUrl, networkPassphrase: publicConfig().networkPassphrase }, u.address, 50n * ONE, log).catch(() => null);
    if (r) {
      u.faucetTaken = true;
      faucet = { amount: s(50n * ONE), txHash: r.txHash };
    }
  }
  return reply(c, KycResponseSchema, { kycStatus: 'approved', approveTxHash: u.approveTxHash, faucet });
});
// Email one-time code, mocked: any email gets the code 123456; verify returns a mock session for the wallet given.
app.post('/auth/otp', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  if (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return c.json({ error: { code: 'invalid_body', message: 'email required' } }, 422);
  return c.json({ ok: true });
});
app.post('/auth/verify', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string; walletAddress?: string };
  if (body.code !== '123456') return c.json({ error: { code: 'bad_code', message: 'the code is wrong or expired' } }, 401);
  const address = body.walletAddress ?? c.req.header('x-wallet-address') ?? 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWE';
  return c.json({ token: `mock.${address}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), profile: { email: body.email ?? null } });
});
app.get('/auth/dev-otp', (c) => c.json({ code: '123456' }));

app.post('/kyb', async (c) => {
  const u = requireUser(c);
  const b = await body(c, KybRequest);
  u.displayName = b.displayName;
  u.email = b.email ?? null;
  u.country = b.country;
  u.importer = { legalName: b.legalName, country: b.country, registrationNumber: b.registrationNumber, kybStatus: 'pending', documents: u.importer?.documents.filter((d) => !b.documentId || d.id === b.documentId) ?? [], faucetGrant: null, submittedAt: nowIso() };
  return reply(c, KycResponseSchema, { kycStatus: 'pending', approveTxHash: null, faucet: null });
});
app.post('/kyb/documents', async (c) => {
  const u = requireUser(c);
  const b = await body(c, RegisterDocumentRequest);
  const id = randomUuid();
  const rec = { id, type: 'kyb' as const, filename: b.filename, mime: b.mime, size: b.size, sha256: b.sha256, pages: null, stage: 'kyb' as const, status: 'pending_upload' as const, uploadedAt: nowIso(), viewUrl: null };
  if (u.importer) u.importer.documents.push(rec);
  else u.importer = { legalName: '', country: u.country ?? 'NG', registrationNumber: '', kybStatus: 'none', documents: [rec], faucetGrant: null, submittedAt: nowIso() };
  return reply(c, RegisterDocumentResponseSchema, { documentId: id, uploadUrl: `http://localhost:${PORT}/uploads/${id}`, method: 'PUT', headers: { 'content-type': b.mime } }, 201);
});
app.post('/faucet', async (c) => {
  const u = requireUser(c);
  if (u.faucetTaken) throw new HttpError(429, 'faucet_used', 'This wallet already received its test dollars.');
  const r = await sendFaucet({ secret: env['FAUCET_SECRET'], tokenId: env['SETTLEMENT_TOKEN_ID'], rpcUrl: publicConfig().rpcUrl, networkPassphrase: publicConfig().networkPassphrase }, u.address, 50n * ONE, log);
  u.faucetTaken = true;
  return reply(c, FaucetResponseSchema, { amount: s(50n * ONE), txHash: r.txHash, mode: r.mode });
});

app.get('/me/portfolio', (c) => {
  const u = requireUser(c);
  bindDemoInvestor(u.address);
  const positions = world.deals
    .filter((d) => d.holders.has(u.address))
    .map((d) => {
      const shares = d.holders.get(u.address)!;
      const expected = (shares * (d.terms.markup - d.terms.platformFee)) / d.terms.cost;
      const claimed = d.claimed.get(u.address);
      const claimable = !claimed && d.state && ['Repaid', 'Cancelled', 'Liquidated'].includes(d.state) ? (shares * d.distributable) / d.funded : null;
      return {
        dealId: d.id,
        number: d.number,
        onchainId: d.onchainId,
        goodsSummary: d.goodsSummary,
        route: `${d.route.originPort} to ${d.route.destinationPort}`,
        state: d.state,
        shares: s(shares),
        expectedProfit: s(expected),
        realisedProfit: claimed ? s(claimed.amount - shares) : null,
        claimable: claimable !== null ? s(claimable) : null,
        claimed: Boolean(claimed),
        claimTxHash: claimed?.txHash ?? null,
        investTxHash: d.investTx.get(u.address)?.txHash ?? null,
        investedAt: d.investTx.get(u.address)?.at ?? d.createdAt,
        dueAt: d.dueAt || null,
        tenorSecs: d.terms.tenorSecs,
      };
    });
  const sum = (f: (p: (typeof positions)[number]) => string | null) => s(positions.reduce((a, p) => a + BigInt(f(p) ?? '0'), 0n));
  return reply(c, PortfolioSchema, { positions, totals: { invested: sum((p) => p.shares), expectedProfit: sum((p) => (p.claimed ? '0' : p.expectedProfit)), realisedProfit: sum((p) => p.realisedProfit), claimable: sum((p) => p.claimable) }, refundOwed: s(world.refunds.get(u.address) ?? 0n) });
});

// --- importer
app.get('/importer/deals', (c) => {
  const u = requireUser(c);
  bindDemoImporter(u.address);
  if (world.demoImporter === u.address) seedRefundFor(u.address);
  const mine = world.deals.filter((d) => d.importer === u.address).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return reply(c, ImporterDealSchema.array(), mine.map(importerDeal));
});
app.get('/importer/deals/:id', (c) => {
  const u = requireUser(c);
  bindDemoImporter(u.address);
  const d = findDeal(c.req.param('id'));
  if (d.importer !== u.address) throw new HttpError(403, 'NotAuthorized', 'This deal belongs to another importer.');
  return reply(c, ImporterDealDetailSchema, { ...detail(d), ...importerDeal(d) });
});
app.post('/deals', async (c) => {
  const u = requireUser(c);
  const b = await body(c, CreateDealRequest);
  const n = world.nextNumber++;
  const originLL: Record<string, [number, number]> = { shenzhen: [114.27, 22.57], yantian: [114.27, 22.57], ningbo: [121.85, 29.93], shanghai: [121.49, 31.23], guangzhou: [113.6, 22.76], qingdao: [120.32, 36.07], xiamen: [118.09, 24.45] };
  const destLL: Record<string, [number, number]> = { lagos: [3.36, 6.44], apapa: [3.36, 6.44], mombasa: [39.66, -4.06], tema: [-0.01, 5.62], dar: [39.28, -6.82], durban: [31.02, -29.87] };
  const pick = (m: Record<string, [number, number]>, name: string) => Object.entries(m).find(([k]) => name.toLowerCase().includes(k))?.[1] ?? null;
  const d: MockDeal = {
    ...world.deals[0]!,
    id: randomUuid(),
    number: n,
    onchainId: null,
    importer: u.address,
    importerName: u.displayName ?? 'Importer',
    importerLegalName: u.importer?.legalName ?? u.displayName ?? 'Importer',
    importerStats: { on_time: 0, late: 0, defaulted: 0, total_repaid: '0', open_exposure: '0' },
    supplier: { nameEn: b.supplier.nameEn, nameZh: b.supplier.nameZh ?? null, uscc: b.supplier.uscc ?? null, payoutAddress: b.supplier.payoutAddress ?? null, confirmed: false },
    goodsSummary: b.goodsSummary,
    route: { originPort: b.originPort, originCountry: 'CN', destinationPort: b.destinationPort, destinationCountry: b.destinationCountry, originLngLat: pick(originLL, b.originPort), destinationLngLat: pick(destLL, b.destinationPort) },
    terms: { cost: 0n, markup: 0n, platformFee: 0n, lateFee: 0n, depositBps: 3000, tenorSecs: b.tenorSecs, acceptWindowSecs: 7 * DAY, fundingDeadline: null, security: 0n, securityBps: SECURITY_CFG.minSecurityBps },
    state: null,
    stage: 'draft',
    funded: 0n,
    supplierPaid: 0n,
    listedAt: 0,
    ownedAt: 0,
    acceptedAt: 0,
    dueAt: 0,
    salePrice: 0n,
    principalRepaid: 0n,
    lateFeeDue: 0n,
    lateFeePaid: 0n,
    recovered: 0n,
    distributable: 0n,
    claimedShares: 0n,
    paidOut: 0n,
    holderCount: 0,
    securityHeld: 0n,
    importerAtFault: false,
    extended: false,
    blFingerprint: null,
    blReportHash: null,
    decision: null,
    riskScore: null,
    report: null,
    documents: [],
    promise: null,
    shipment: null,
    tracking: null,
    timeline: [],
    payments: [],
    shareToken: null,
    issuerPublicKey: null,
    listingTxHashes: {},
    holders: new Map(),
    claimed: new Map(),
    investTx: new Map(),
    audit: [],
    incidents: [],
    agentActions: [],
    recoveries: [],
    recoveryNotes: [],
    abort: null,
    extension: null,
    blReleasedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  world.deals.push(d);
  return reply(c, CreateDealResponseSchema, { id: d.id, number: d.number, status: 'draft' }, 201);
});
app.patch('/deals/:id', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  if (d.importer !== u.address) throw new HttpError(403, 'NotAuthorized', 'This deal belongs to another importer.');
  if (d.state) throw new HttpError(409, 'InvalidState', 'Terms cannot change after listing.');
  const b = await body(c, UpdateDealTermsRequest);
  if (b.cost) {
    d.terms.cost = BigInt(b.cost);
    d.terms.security = requiredSecurity(d.terms.cost, d.importerStats.on_time, SECURITY_CFG);
    d.terms.platformFee = d.terms.cost / 50n;
    d.terms.lateFee = d.terms.cost / 200n;
  }
  if (b.markup) d.terms.markup = BigInt(b.markup);
  if (b.tenorSecs) d.terms.tenorSecs = b.tenorSecs;
  if (b.depositBps !== undefined) d.terms.depositBps = b.depositBps;
  if (b.supplierPayoutAddress) d.supplier.payoutAddress = b.supplierPayoutAddress;
  touch(d);
  return reply(c, ImporterDealSchema, importerDeal(d));
});
app.post('/deals/:id/documents', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  if (d.importer !== u.address) throw new HttpError(403, 'NotAuthorized', 'This deal belongs to another importer.');
  const b = await body(c, RegisterDocumentRequest);
  const id = randomUuid();
  const existing = d.documents.find((x) => x.type === b.type && x.stage === (b.type === 'bill_of_lading' ? 'shipment' : 'listing'));
  if (existing) d.documents = d.documents.filter((x) => x !== existing);
  d.documents.push({ id, type: b.type, filename: b.filename, mime: b.mime, size: b.size, sha256: b.sha256, pages: null, stage: b.type === 'bill_of_lading' ? 'shipment' : b.type === 'kyb' ? 'kyb' : 'listing', status: 'pending_upload', uploadedAt: nowIso(), viewUrl: null });
  if (d.report && d.stage === 'review') d.stage = 'draft';
  touch(d);
  return reply(c, RegisterDocumentResponseSchema, { documentId: id, uploadUrl: `http://localhost:${PORT}/uploads/${id}`, method: 'PUT', headers: { 'content-type': b.mime } }, 201);
});
const uploads = new Map<string, { mime: string; bytes: Uint8Array }>();
app.put('/uploads/:id', async (c) => {
  const id = c.req.param('id');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  uploads.set(id, { mime: c.req.header('content-type') ?? 'application/octet-stream', bytes });
  for (const d of world.deals) {
    const doc = d.documents.find((x) => x.id === id);
    if (doc) {
      doc.status = 'uploaded';
      doc.viewUrl = `http://localhost:${PORT}/uploads/${id}`;
      doc.pages = 1;
      touch(d);
    }
  }
  for (const u of world.users.values()) {
    const doc = u.importer?.documents.find((x) => x.id === id);
    if (doc) {
      doc.status = 'uploaded';
      doc.viewUrl = `http://localhost:${PORT}/uploads/${id}`;
      doc.pages = 1;
    }
  }
  return c.body(null, 204);
});
app.get('/uploads/:id', (c) => {
  const up = uploads.get(c.req.param('id'));
  if (up) return c.body(up.bytes.buffer as ArrayBuffer, 200, { 'content-type': up.mime });
  return c.text(`Mock document ${c.req.param('id')}. The real API serves a short-lived signed URL from a private bucket.`, 200, { 'content-type': 'text/plain' });
});
app.post('/deals/:id/verify', (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  if (d.importer !== u.address) throw new HttpError(403, 'NotAuthorized', 'This deal belongs to another importer.');
  const docs = d.documents.filter((x) => x.stage === 'listing' && x.status === 'uploaded');
  if (docs.length < 3) throw new HttpError(409, 'documents_missing', 'Upload the invoice, the packing list and the supplier licence first.');
  if (d.terms.cost <= 0n) throw new HttpError(409, 'terms_missing', 'Set the cost of the goods first.');
  const job = { id: randomUuid(), kind: 'verify_listing', status: 'queued' as const, attempts: 0, lastError: null, result: null, dealId: d.id };
  world.jobs.set(job.id, job);
  d.stage = 'verifying';
  touch(d);
  setTimeout(() => {
    const j = world.jobs.get(job.id);
    if (j) {
      j.status = 'running';
      j.attempts = 1;
    }
  }, 1500);
  setTimeout(() => {
    const j = world.jobs.get(job.id);
    if (!j) return;
    const g = d.goodsSummary.toLowerCase();
    const kind = /wine|beer|whisky|vodka|pork|tobacco|cigarette|vape|casino/.test(g) ? 'reject' : /review|unsure|blurry/.test(g) ? 'review' : 'approve';
    d.report = buildReport(d, kind, kind === 'review' ? { weightGapPct: 3.2 } : {});
    if (kind === 'reject') {
      d.report.rejectCategory = 'prohibited_goods';
      d.report.report.checks = d.report.report.checks.map((ch) => (ch.name === 'halal_screen' ? { ...ch, status: 'fail', detail: 'A line item is in a prohibited category (alcohol, pork, tobacco or gambling).' } : ch));
      d.report.report.halal = [{ line: d.goodsSummary, category: 'prohibited', verdict: 'prohibited', reason: 'Prohibited category under the halal policy.' }];
      d.report.explanation = 'This deal cannot go ahead: one of the goods is in a prohibited category under the halal policy. The same files cannot be submitted again.';
      d.report.fixes = [];
    }
    d.decision = kind;
    d.riskScore = d.report.riskScore;
    d.stage = kind === 'approve' ? 'approved' : kind === 'review' ? 'review' : 'rejected';
    j.status = 'done';
    j.result = { decision: kind, riskScore: d.riskScore };
    touch(d);
    log(`[mock] screening of deal ${d.number} finished: ${kind}`);
  }, 6000);
  return reply(c, VerifyResponseSchema, { jobId: job.id }, 202);
});
app.get('/jobs/:id', (c) => {
  const j = world.jobs.get(c.req.param('id'));
  if (!j) throw new HttpError(404, 'job_not_found', 'Unknown job.');
  return reply(c, JobStatusSchema, { id: j.id, kind: j.kind, status: j.status, attempts: j.attempts, lastError: j.lastError, result: j.result });
});
app.get('/deals/:id/report', (c) => {
  const d = findDeal(c.req.param('id'));
  if (!d.report) throw new HttpError(404, 'no_report', 'No report yet. Run screening first.');
  return reply(c, ReportResponseSchema, { ...d.report, verifierPublicKey: verifierHex() });
});
app.post('/deals/:id/promise', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  if (d.importer !== u.address) throw new HttpError(403, 'NotAuthorized', 'This deal belongs to another importer.');
  if (d.decision !== 'approve' && d.stage !== 'approved') throw new HttpError(409, 'not_approved', 'The deal must be approved before the promise.');
  const fp = d.promise?.listingFingerprint ?? sha256hex(`fp-${d.id}`);
  const security = requiredSecurity(d.terms.cost, d.importerStats.on_time, SECURITY_CFG);
  const bps = Math.max(SECURITY_CFG.securityFloorBps, SECURITY_CFG.minSecurityBps - d.importerStats.on_time * SECURITY_CFG.securityStepBps);
  const text = renderPromiseText({
    importerName: d.importerLegalName,
    importerAddress: u.address,
    entityName: ENTITY_NAME,
    dealNumber: d.number,
    goodsSummary: d.goodsSummary,
    supplierName: d.supplier.nameEn,
    cost: d.terms.cost,
    markup: d.terms.markup,
    security,
    securityBps: bps,
    tenorDays: Math.max(1, Math.round(d.terms.tenorSecs / DAY)),
    acceptWindowDays: Math.max(1, Math.round(d.terms.acceptWindowSecs / DAY)),
    tokenCode: publicConfig().settlementToken.code,
    listingFingerprintHex: fp,
  });
  d.terms.security = security;
  d.terms.securityBps = bps;
  if (!d.promise?.txHash) d.promise = { text, textHash: sha256hex(text), listingFingerprint: fp, security, securityBps: bps, txHash: null, signedAt: null };
  touch(d);
  return reply(c, PromiseResponse, { text: d.promise.text, textHash: d.promise.textHash, listingFingerprint: fp, security: s(security), securityBps: bps, cost: s(d.terms.cost), templateVersion: PROMISE_VERSION });
});
app.post('/deals/:id/promise/submitted', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  const b = await body(c, TxSubmittedRequest);
  if (d.importer !== u.address || !d.promise) throw new HttpError(409, 'NoPromise', 'Prepare the promise first.');
  if (!d.promise.txHash) {
    d.promise.txHash = b.txHash;
    d.promise.signedAt = nowIso();
    d.stage = 'promised';
    d.timeline.push({ ...ev(d, 'promised', nowSecs(), { importer: u.address, security: s(d.promise.security) }, `Importer signed the purchase promise and locked a security deposit of ${money(d.promise.security)}`, ledger()), txHash: b.txHash });
    d.payments.push(pay('security_locked', d.promise.security, nowSecs(), b.txHash));
    touch(d);
  }
  return reply(c, OkSchema, { ok: true });
});
app.post('/deals/:id/shipment', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  if (d.importer !== u.address) throw new HttpError(403, 'NotAuthorized', 'This deal belongs to another importer.');
  if (d.state !== 'DepositPaid') throw new HttpError(409, 'InvalidState', 'The bill of lading can be uploaded once the supplier deposit is paid.');
  const b = await body(c, ShipmentRequest);
  d.shipment = { carrier: b.carrier, blNumber: b.blNumber, containers: b.containers, status: 'Loaded', documentId: b.documentId };
  d.tracking = mockTracking(d, 'Loaded', nowSecs());
  d.timeline.push(ev(d, 'bl_uploaded', nowSecs(), { bl: b.blNumber, carrier: b.carrier }, 'Bill of lading uploaded, carrier tracking started', ledger()));
  const job = { id: randomUuid(), kind: 'verify_shipment', status: 'queued' as const, attempts: 0, lastError: null, result: null, dealId: d.id };
  world.jobs.set(job.id, job);
  touch(d);
  setTimeout(() => {
    if (d.state === 'DepositPaid') {
      d.tracking = mockTracking(d, 'Sailing', nowSecs());
      confirmShipment(d, nowSecs(), ledger());
      const j = world.jobs.get(job.id);
      if (j) {
        j.status = 'done';
        j.result = { confirmed: true };
      }
      touch(d);
      log(`[mock] agent confirmed shipment of deal ${d.number}`);
    }
  }, 20_000);
  return reply(c, ShipmentResponseSchema, { shipmentId: randomUuid(), jobId: job.id }, 202);
});
app.post('/deals/:id/extension-request', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  if (d.importer !== u.address) throw new HttpError(403, 'NotAuthorized', 'This deal belongs to another importer.');
  if (d.state !== 'Sold') throw new HttpError(409, 'InvalidState', 'An extension can only be asked for after the sale.');
  if (d.extended || d.extension) throw new HttpError(409, 'AlreadyExtended', 'An extension was already requested or granted on this deal.');
  const b = await body(c, ExtensionRequest);
  d.extension = { requested: true, reason: b.reason, decision: 'pending', newDueAt: null };
  touch(d);
  return reply(c, OkSchema, { ok: true });
});
app.get('/deals/:id/tradefile', (c) => {
  const d = findDeal(c.req.param('id'));
  return reply(c, TradeFileSchema, {
    url: `http://localhost:${PORT}/tradefile/${d.id}.txt`,
    filename: `qafila-deal-${d.number}-trade-file.zip`,
    bytes: 412_338,
    contents: [...d.documents.map((x) => x.filename), 'verification-report.json', 'verification-report.sig', 'promise.txt', 'transactions.csv', 'README.txt'],
  });
});
app.get('/tradefile/:file', (c) => c.text(`Qafila trade file (mock). The real API streams a zip with the documents, the signed report, the promise and transaction links.`, 200, { 'content-type': 'text/plain', 'content-disposition': 'attachment' }));

// --- mock chain: applies what the contract would do, returns a fake hash (used only when NEXT_PUBLIC_MOCK_CHAIN=1)
app.post('/mock/chain', async (c) => {
  const raw = (await c.req.json().catch(() => ({}))) as { fn?: string; args?: Record<string, unknown> };
  const fn = raw.fn ?? '';
  const a = raw.args ?? {};
  // The contract learns the caller from the auth entry; the mock takes it from the session header.
  const caller = who(c) ?? '';
  const str = (k: string) => String(a[k] ?? (k === 'importer' || k === 'investor' || k === 'holder' || k === 'addr' ? caller : ''));
  const big = (k: string) => BigInt(String(a[k] ?? '0'));
  const num = (k: string) => Number(a[k] ?? 0);
  log(`[mock] chain call ${fn} ${JSON.stringify(a)}`);
  switch (fn) {
    case 'invest':
      return c.json({ hash: doInvest(findByOnchain(num('deal_id')), str('investor'), big('amount')), mode: 'mock' });
    case 'promise_purchase':
      return c.json({ hash: doPromise(str('listing_fingerprint'), str('importer'), big('security')), mode: 'mock' });
    case 'withdraw_promise':
      return c.json({ hash: doWithdrawPromise(str('listing_fingerprint'), str('importer')), mode: 'mock' });
    case 'accept_murabaha':
      return c.json({ hash: doAccept(findByOnchain(num('deal_id')), str('importer')), mode: 'mock' });
    case 'repay':
      return c.json({ hash: doRepay(findByOnchain(num('deal_id')), str('importer'), big('amount')), mode: 'mock' });
    case 'pay_late_fee':
      return c.json({ hash: doLateFee(findByOnchain(num('deal_id')), str('importer'), big('amount')), mode: 'mock' });
    case 'claim': {
      const r = doClaim(findByOnchain(num('deal_id')), str('holder'));
      return c.json({ hash: r.tx, result: s(r.amount), mode: 'mock' });
    }
    case 'withdraw_refund': {
      const r = doWithdrawRefund(str('addr'));
      return c.json({ hash: r.tx, result: s(r.amount), mode: 'mock' });
    }
    case 'refund_of':
      return c.json({ result: s(world.refunds.get(str('addr')) ?? 0n) });
    case 'required_security':
      return c.json({ result: s(requiredSecurity(big('cost'), 0, SECURITY_CFG)) });
    case 'quote_claim': {
      const d = findByOnchain(num('deal_id'));
      const sh = d.holders.get(str('holder')) ?? 0n;
      return c.json({ result: s(d.funded > 0n ? (sh * d.distributable) / d.funded : 0n) });
    }
    default:
      throw new HttpError(400, 'unknown_fn', `mock chain does not know ${fn}`);
  }
});

// --- ops
const opsOk = (c: Context, txHash: string | null, message: string | null = null, txHashes: Record<string, string> | null = null) => reply(c, OpsActionResponseSchema, { ok: true, txHash, txHashes, message });

app.get('/ops/queue', (c) => {
  requireUser(c);
  const items = world.deals.map(opsQueueItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return reply(c, OpsQueueItemSchema.array(), items);
});
app.get('/ops/deals/:id', (c) => {
  requireUser(c);
  return reply(c, OpsDealDetailSchema, opsDetail(findDeal(c.req.param('id'))));
});
app.post('/ops/deals/:id/override', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  const b = await body(c, OverrideRequest);
  if (!d.report) throw new HttpError(409, 'no_report', 'No report to override.');
  const before = d.decision;
  d.decision = b.decision;
  d.report.decision = b.decision;
  d.stage = b.decision === 'approve' ? 'approved' : b.decision === 'review' ? 'review' : 'rejected';
  d.audit.push({ id: randomUuid(), actor: u.address, action: `override ${before} -> ${b.decision}`, reason: b.reason, at: nowIso(), txHash: null });
  touch(d);
  return opsOk(c, null, `Decision changed from ${before} to ${b.decision}.`);
});
app.post('/ops/deals/:id/list', (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  if (d.state) throw new HttpError(409, 'InvalidState', 'Already listed.');
  if (!d.promise?.txHash) throw new HttpError(409, 'NoPromise', 'The importer has not signed the purchase promise yet.');
  if (d.decision !== 'approve') throw new HttpError(409, 'not_approved', 'Only approved deals can be listed.');
  const now = nowSecs();
  d.onchainId = world.nextOnchain++;
  d.state = 'Listed';
  d.stage = 'listed';
  d.listedAt = now;
  d.securityHeld = d.promise.security;
  d.terms.fundingDeadline = d.terms.fundingDeadline ?? now + 7 * DAY;
  d.shareToken = fakeC(`share-${d.number}-${now}`);
  d.issuerPublicKey = fakeG(`issuer-${d.number}-${now}`);
  d.listingTxHashes = { issuer_created: fakeTx(), flags_set: fakeTx(), sac_deployed: fakeTx(), admin_set: fakeTx(), issuer_locked: fakeTx(), list_deal: fakeTx() };
  d.timeline.push({ ...ev(d, 'deal_listed', now, { deal_id: d.onchainId, cost: s(d.terms.cost), share_token: d.shareToken }, `Deal ${d.number} listed with the verifier's signature over its terms`, ledger()), txHash: d.listingTxHashes['list_deal']! });
  d.audit.push({ id: randomUuid(), actor: u.address, action: 'list_deal', reason: null, at: nowIso(), txHash: d.listingTxHashes['list_deal']! });
  // Qafila co-invests 5% right away (FLOWS 3).
  investAt(d, fakeG('coinvest'), (d.terms.cost * BigInt(COINVEST_BPS)) / 10000n, now + 2, ledger());
  touch(d);
  return opsOk(c, d.listingTxHashes['list_deal']!, 'Share token issued and locked; deal listed.', d.listingTxHashes);
});
app.post('/ops/deals/:id/pay-deposit', (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  if (d.state !== 'Funded') throw new HttpError(409, 'InvalidState', 'The supplier deposit can be paid once the deal is funded.');
  payDeposit(d, nowSecs(), ledger(), 'ops');
  d.audit.push({ id: randomUuid(), actor: u.address, action: 'pay_supplier_deposit', reason: null, at: nowIso(), txHash: d.payments[d.payments.length - 1]!.txHash });
  touch(d);
  return opsOk(c, d.payments[d.payments.length - 1]!.txHash);
});
app.post('/ops/deals/:id/confirm-shipment', (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  if (d.state !== 'DepositPaid' || !d.shipment) throw new HttpError(409, 'InvalidState', 'Needs a funded deal with a bill of lading.');
  d.tracking = mockTracking(d, 'Sailing', nowSecs());
  confirmShipment(d, nowSecs(), ledger());
  d.audit.push({ id: randomUuid(), actor: u.address, action: 'confirm_shipment (manual trigger)', reason: null, at: nowIso(), txHash: d.payments[d.payments.length - 1]!.txHash });
  touch(d);
  return opsOk(c, d.payments[d.payments.length - 1]!.txHash);
});
app.post('/ops/deals/:id/abort', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  const b = await body(c, AbortRequest);
  if (!d.state || !['Listed', 'Funded', 'DepositPaid', 'Owned'].includes(d.state)) throw new HttpError(409, 'InvalidState', 'This deal cannot be aborted in its current state.');
  const reason = ABORT_REASONS[b.reason as AbortReason];
  const atFault = b.importerAtFault ?? reason.atFault;
  const now = nowSecs();
  const tx = fakeTx();
  if (d.state === 'Listed' || d.state === 'Funded') {
    d.state = 'Cancelled';
    d.stage = 'cancelled';
    d.distributable = d.funded;
    refundSecurity(d, now);
  } else {
    d.state = 'Defaulted';
    d.stage = 'defaulted';
    d.importerAtFault = atFault;
    if (!atFault) refundSecurity(d, now);
    if (atFault) d.importerStats.defaulted += 1;
  }
  d.abort = { reason: b.reason, importerAtFault: atFault, note: b.note, at: nowIso(), txHash: tx };
  d.timeline.push({ ...ev(d, 'aborted', now, { reason: b.reason, importer_at_fault: atFault }, `Ops stopped the deal: ${reason.label}${atFault ? ' (importer at fault)' : ''}`, ledger()), txHash: tx });
  d.audit.push({ id: randomUuid(), actor: u.address, action: `abort_deal(${atFault})`, reason: `${reason.label}. ${b.note}`, at: nowIso(), txHash: tx });
  touch(d);
  return opsOk(c, tx);
});
app.post('/ops/deals/:id/default', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  const b = await body(c, NoteRequest);
  if (d.state !== 'Sold') throw new HttpError(409, 'InvalidState', 'Only a sold deal can default.');
  if (nowSecs() <= d.dueAt + CONTRACT_CFG.grace_secs) throw new HttpError(409, 'DueNotPassed', 'The due date plus the grace period has not passed.');
  const tx = fakeTx();
  d.state = 'Defaulted';
  d.stage = 'defaulted';
  d.importerStats.defaulted += 1;
  d.recoveryNotes.push({ note: b.note, at: nowIso(), by: u.address });
  d.timeline.push({ ...ev(d, 'defaulted', nowSecs(), { deal_id: d.onchainId }, 'Ops marked the deal in default; recovery starts', ledger()), txHash: tx });
  d.audit.push({ id: randomUuid(), actor: u.address, action: 'mark_default', reason: b.note, at: nowIso(), txHash: tx });
  touch(d);
  return opsOk(c, tx);
});
app.post('/ops/deals/:id/recovery', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  const b = await body(c, RecoveryRequest);
  if (d.state !== 'Defaulted') throw new HttpError(409, 'InvalidState', 'Recoveries go in while the deal is in default.');
  const amount = BigInt(b.amount);
  if (d.salePrice > 0n && d.principalRepaid + d.recovered + amount > d.salePrice) throw new HttpError(409, 'ExceedsRemaining', `Recoveries cannot exceed what is still owed: ${money(d.salePrice - d.principalRepaid - d.recovered)}.`);
  const tx = fakeTx();
  d.recovered += amount;
  d.recoveries.push({ amount, from: b.from ?? null, note: b.note, txHash: tx, at: nowIso() });
  d.payments.push(pay('recovery', amount, nowSecs(), tx));
  d.timeline.push({ ...ev(d, 'recovery', nowSecs(), { amount: s(amount) }, `Recovery of ${money(amount)} deposited: ${b.note}`, ledger()), txHash: tx });
  d.audit.push({ id: randomUuid(), actor: u.address, action: 'deposit_recovery', reason: b.note, at: nowIso(), txHash: tx });
  touch(d);
  return opsOk(c, tx);
});
app.post('/ops/deals/:id/finalize', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  const b = await body(c, NoteRequest);
  if (d.state !== 'Defaulted') throw new HttpError(409, 'InvalidState', 'Only a defaulted deal can be finalized.');
  const now = nowSecs();
  const tx = fakeTx();
  let balance = d.funded - d.supplierPaid + d.principalRepaid + d.recovered;
  if (d.salePrice === 0n && d.securityHeld > 0n) {
    const loss = d.funded - balance > 0n ? d.funded - balance : 0n;
    const used = loss < d.securityHeld ? loss : d.securityHeld;
    balance += used;
    const rest = d.securityHeld - used;
    d.securityHeld = rest;
    d.timeline.push({ ...ev(d, 'security_used', now, { amount: s(used) }, `${money(used)} of the security deposit used for the actual loss`, ledger()), txHash: tx });
    refundSecurity(d, now);
  }
  d.distributable = balance;
  d.state = 'Liquidated';
  d.stage = 'liquidated';
  d.recoveryNotes.push({ note: b.note, at: nowIso(), by: u.address });
  d.timeline.push({ ...ev(d, 'liquidated', now, { distributable: s(balance) }, `Deal wound up; ${money(balance)} to share pro rata`, ledger()), txHash: tx });
  d.audit.push({ id: randomUuid(), actor: u.address, action: 'finalize_default', reason: b.note, at: nowIso(), txHash: tx });
  touch(d);
  return opsOk(c, tx);
});
app.post('/ops/deals/:id/extend', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  const b = await body(c, ExtendRequest);
  if (d.state !== 'Sold') throw new HttpError(409, 'InvalidState', 'Only a sold deal can be extended.');
  if (d.extended) throw new HttpError(409, 'AlreadyExtended', 'This deal was already extended once.');
  if (b.newDueAt <= d.dueAt || b.newDueAt > d.dueAt + CONTRACT_CFG.max_extension_secs) throw new HttpError(409, 'InvalidDueDate', `The new due date must be after the current one and at most ${CONTRACT_CFG.max_extension_secs} seconds later on testnet.`);
  const tx = fakeTx();
  d.dueAt = b.newDueAt;
  d.extended = true;
  d.extension = { requested: d.extension?.requested ?? false, reason: d.extension?.reason ?? null, decision: 'granted', newDueAt: b.newDueAt };
  d.timeline.push({ ...ev(d, 'due_extended', nowSecs(), { new_due_at: b.newDueAt }, 'Due date extended once; the price is unchanged', ledger()), txHash: tx });
  d.audit.push({ id: randomUuid(), actor: u.address, action: 'extend_due', reason: b.note, at: nowIso(), txHash: tx });
  touch(d);
  return opsOk(c, tx);
});
app.post('/ops/deals/:id/refuse-extension', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  const b = await body(c, NoteRequest);
  if (!d.extension || d.extension.decision !== 'pending') throw new HttpError(409, 'no_request', 'No pending extension request.');
  d.extension.decision = 'refused';
  d.audit.push({ id: randomUuid(), actor: u.address, action: 'refuse_extension', reason: b.note, at: nowIso(), txHash: null });
  touch(d);
  return opsOk(c, null);
});
app.post('/ops/deals/:id/release-bl', async (c) => {
  const u = requireUser(c);
  const d = findDeal(c.req.param('id'));
  const b = await body(c, NoteRequest);
  if (d.state !== 'Sold' && d.state !== 'Repaid') throw new HttpError(409, 'InvalidState', 'The bill of lading is released after the importer signs the sale.');
  d.blReleasedAt = nowIso();
  d.timeline.push(ev(d, 'bl_released', nowSecs(), { note: b.note }, 'Bill of lading released to the importer', ledger()));
  d.audit.push({ id: randomUuid(), actor: u.address, action: 'release_bl', reason: b.note, at: nowIso(), txHash: null });
  touch(d);
  return opsOk(c, null, 'Release recorded.');
});
app.get('/ops/kyc', (c) => {
  requireUser(c);
  const items = [...world.users.values()]
    .filter((u) => u.importer && u.importer.kybStatus === 'pending')
    .map((u) => ({ id: u.address, kind: 'importer' as const, displayName: u.displayName ?? 'Importer', country: u.importer!.country, walletAddress: u.address, legalName: u.importer!.legalName, registrationNumber: u.importer!.registrationNumber, documents: u.importer!.documents, submittedAt: u.importer!.submittedAt, status: 'pending' as const }));
  if (items.length === 0 && !world.users.has(fakeC('pending-importer'))) {
    items.push({ id: fakeC('pending-importer'), kind: 'importer', displayName: 'Fatima', country: 'KE', walletAddress: fakeC('pending-importer'), legalName: 'Fatima Agro Imports Ltd', registrationNumber: 'PVT-9KX2L7', documents: [], submittedAt: iso(nowSecs() - 2 * HOUR), status: 'pending' });
  }
  return reply(c, KycQueueSchema, items);
});
app.post('/ops/kyc/:id/approve', async (c) => {
  requireUser(c);
  const id = c.req.param('id');
  const u = world.users.get(id);
  if (!u) {
    if (id === fakeC('pending-importer')) {
      ensureUser(id).importer = { legalName: 'Fatima Agro Imports Ltd', country: 'KE', registrationNumber: 'PVT-9KX2L7', kybStatus: 'approved', documents: [], faucetGrant: { amount: 20_250n * ONE, txHash: fakeTx() }, submittedAt: nowIso() };
      return opsOk(c, world.users.get(id)!.importer!.faucetGrant!.txHash, 'Approved. Faucet grant sent.');
    }
    throw new HttpError(404, 'not_found', 'Unknown applicant.');
  }
  if (!u.importer) throw new HttpError(409, 'not_importer', 'This user has no KYB application.');
  u.importer.kybStatus = 'approved';
  const grant = (BigInt(CONTRACT_CFG.base_importer_limit) * 135n) / 100n;
  const r = await sendFaucet({ secret: env['FAUCET_SECRET'], tokenId: env['SETTLEMENT_TOKEN_ID'], rpcUrl: publicConfig().rpcUrl, networkPassphrase: publicConfig().networkPassphrase }, u.address, grant, log).catch((e: Error) => {
    log(`[mock] importer grant failed: ${e.message}`);
    return { txHash: fakeTx(), mode: 'mock' as const };
  });
  u.importer.faucetGrant = { amount: grant, txHash: r.txHash };
  return opsOk(c, r.txHash, `Approved. Faucet grant of ${money(grant)} sent (${r.mode}).`);
});
app.get('/ops/agent', (c) => {
  requireUser(c);
  return reply(c, AgentLogSchema, {
    actions: world.deals.flatMap((d) => d.agentActions).sort((a, b) => b.at.localeCompare(a.at)),
    incidents: world.deals.flatMap((d) => d.incidents).sort((a, b) => b.at.localeCompare(a.at)),
    deadJobs: [],
    agentAddress: world.agentAddress,
    mode: 'dry_run',
  });
});
app.get('/ops/policy', (c) => {
  requireUser(c);
  return reply(c, PolicySchema, world.policy);
});
app.put('/ops/policy', async (c) => {
  const u = requireUser(c);
  const b = await body(c, PolicyUpdateRequest);
  world.policy = { ...b, version: world.policy.version + 1, updatedBy: u.address, updatedAt: nowIso() };
  return reply(c, PolicySchema, world.policy);
});

// --- fee-sponsoring relayer for smart accounts (kit relayer-proxy protocol)
if (env['RELAYER_SECRET']) {
  const cfg = publicConfig();
  app.route(
    '/relayer',
    relayerApp(
      {
        secret: env['RELAYER_SECRET'],
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
        allowedContracts: [cfg.contractId, env['PROBE_CONTRACT_ID'], env['NEXT_PUBLIC_PROBE_CONTRACT_ID'], cfg.settlementToken.id].filter((x): x is string => Boolean(x)),
        allowedWasmHashes: [cfg.smartAccount.wasmHash].filter((x): x is string => Boolean(x)),
        maxResourceFeeStroops: BigInt(env['RELAYER_MAX_RESOURCE_FEE_STROOPS'] ?? '1500000000'),
        inclusionFeeStroops: env['RELAYER_INCLUSION_FEE_STROOPS'] ?? '10000',
        perIpPerMinute: Number(env['RELAYER_PER_IP_PER_MINUTE'] ?? 30),
      },
      log,
    ),
  );
}

serve({ fetch: app.fetch, port: PORT }, () => {
  log(`[mock] Qafila mock API listening on http://localhost:${PORT} (deals: ${world.deals.length}, faucet: ${env['FAUCET_SECRET'] && env['SETTLEMENT_TOKEN_ID'] ? 'live testnet qUSD' : 'mock'}, relayer: ${env['RELAYER_SECRET'] ? `/relayer from ${env['RELAYER_SECRET'].slice(0, 2)}…` : 'off'})`);
});
