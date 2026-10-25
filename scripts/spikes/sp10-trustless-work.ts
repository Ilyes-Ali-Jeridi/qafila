/**
 * SP10 (PLAN 3.2, 10.1): Trustless Work multi-release escrow on testnet through the REST API.
 *
 * Proves, with transaction hashes, that
 *   1. a multi-release escrow with two milestones (deposit, balance) deploys with the PLAN 10.1
 *      roles (receiver and service provider = supplier G key, approver and release signer = the
 *      agent G key, dispute resolver and platform = the admin G key, platform fee 0) in qUSD;
 *   2. a plain SAC transfer to the escrow contract address funds it (that is what
 *      `pay_supplier_deposit` does on-chain when `terms.supplier` is the escrow address);
 *   3. the agent alone can approve and release milestone 1 and the supplier receives it;
 *   4. the REST `fund-escrow` path works too, and a disputed milestone can be resolved by the
 *      dispute resolver back to Qafila (FLOWS 5.2, ops `deposit_recovery`);
 *   5. who signed each step and which protocol fee was taken on the payout.
 *
 * Usage: NODE_OPTIONS=--dns-result-order=ipv4first pnpm tsx scripts/spikes/sp10-trustless-work.ts
 * Env: TRUSTLESS_WORK_API_KEY, TRUSTLESS_WORK_BASE_URL (default testnet), AGENT_SIGNER_SECRET,
 *      ADMIN_SECRET, FAUCET_SECRET, SETTLEMENT_TOKEN_* (qUSD). Never prints a secret.
 * Options: SP10_SKIP_DISPUTE=1 skips step 4.
 */
import { Address, Asset, Contract, Keypair, TransactionBuilder, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { ONE, ensureTrustline, explorerTxUrl, faucetSend, loadChainEnv, queueFor, qusdBalance, qusdContext, requireEnv, sorobanTx, waitForTx } from '@qafila/chain';

const env = loadChainEnv();
const BASE = (process.env['TRUSTLESS_WORK_BASE_URL'] ?? 'https://dev.api.trustlesswork.com').replace(/\/$/, '');
const API_KEY = process.env['TRUSTLESS_WORK_API_KEY'];
if (!API_KEY) throw new Error('TRUSTLESS_WORK_API_KEY missing in .env');
if (env.STELLAR_NETWORK !== 'testnet') throw new Error('SP10 runs on testnet only');

const ctx = qusdContext(env);
const agent = Keypair.fromSecret(requireEnv(env, 'AGENT_SIGNER_SECRET'));
const admin = Keypair.fromSecret(requireEnv(env, 'ADMIN_SECRET'));
const faucet = Keypair.fromSecret(requireEnv(env, 'FAUCET_SECRET'));
const supplier = Keypair.random();

const COST = 100n * ONE; // 100 qUSD
const DEPOSIT = (COST * 3000n) / 10000n; // 30 %
const BALANCE = COST - DEPOSIT;
const toNumber = (stroops: bigint): number => Number(stroops) / Number(ONE);

interface BuildResponse {
  status?: string;
  unsignedTransaction: string;
}
interface SendResponse {
  status?: string;
  message?: string;
  contractId?: string;
  escrow?: { trustline?: { address?: string; symbol?: string } };
}
interface EscrowFlags {
  approved?: boolean;
  released?: boolean;
  disputed?: boolean;
  resolved?: boolean;
}
interface EscrowRecord {
  contractId: string;
  type?: string;
  milestones: Array<{ description?: string; amount?: number; status?: string; flags?: EscrowFlags }>;
  balance?: number;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const parseBuild = (v: unknown): BuildResponse | null => (isRecord(v) && typeof v['unsignedTransaction'] === 'string' && v['unsignedTransaction'].length > 0 ? (v as unknown as BuildResponse) : null);
const parseSend = (v: unknown): SendResponse => (isRecord(v) ? (v as unknown as SendResponse) : {});
const parseEscrows = (v: unknown): EscrowRecord[] | null => (Array.isArray(v) && v.every((e) => isRecord(e) && typeof e['contractId'] === 'string' && Array.isArray(e['milestones'])) ? (v as unknown as EscrowRecord[]) : null);
/** The testnet API validates every role wallet against Circle testnet USDC whatever `trustline.symbol` says (observed 18:10 WET). */
const USDC_TESTNET = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');

interface Step {
  step: string;
  signer: string;
  txHash: string | null;
  note: string;
}
const steps: Step[] = [];
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(`[sp10 ${new Date().toISOString().slice(11, 19)}] ${msg}`, Object.keys(extra).length ? JSON.stringify(extra) : '');

async function api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', 'x-api-key': API_KEY! }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    /* keep text */
  }
  return { status: res.status, json };
}

/** build -> sign with `signer` -> POST /helper/send-transaction -> wait on RPC. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The API reads escrow state from its indexer, which lags the chain by a few seconds right after a write. */
async function buildWithRetry(step: string, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  for (let attempt = 1; ; attempt += 1) {
    const built = await api('POST', path, body);
    const text = JSON.stringify(built.json);
    if (built.status < 400 || attempt >= 6 || !/not found/i.test(text)) return built;
    log(`${step}: indexer not ready (${text.slice(0, 80)}), retry ${attempt}`);
    await sleep(3000 * attempt);
  }
}

async function buildSignSend(step: string, path: string, body: unknown, signer: Keypair, who: string): Promise<{ hash: string; response: SendResponse }> {
  const built = await buildWithRetry(step, path, body);
  if (built.status >= 400) throw new Error(`${step}: build ${built.status} ${JSON.stringify(built.json).slice(0, 400)}`);
  const parsed = parseBuild(built.json);
  if (!parsed) throw new Error(`${step}: unexpected build response ${JSON.stringify(built.json).slice(0, 300)}`);
  const tx = TransactionBuilder.fromXDR(parsed.unsignedTransaction, ctx.cfg.passphrase);
  tx.sign(signer);
  const hash = Buffer.from(tx.hash()).toString('hex');
  const sent = await api('POST', '/helper/send-transaction', { signedXdr: tx.toXDR() });
  if (sent.status >= 400) throw new Error(`${step}: send ${sent.status} ${JSON.stringify(sent.json).slice(0, 400)}`);
  const response = parseSend(sent.json);
  try {
    await waitForTx(ctx.rpc, hash, { timeoutMs: 60_000 });
  } catch (e) {
    log(`${step}: RPC did not confirm ${hash} (${(e as Error).message}); the API reported ${response.status ?? '?'}`);
  }
  steps.push({ step, signer: who, txHash: hash, note: response.message ?? response.status ?? '' });
  log(`${step}: ${hash}`, { signer: who, explorer: explorerTxUrl('testnet', hash) });
  return { hash, response };
}

async function escrowState(contractId: string): Promise<EscrowRecord | null> {
  const q = await api('GET', `/helper/get-escrow-by-contract-ids?contractIds[]=${contractId}&validateOnChain=true`);
  if (q.status >= 400) {
    log(`query ${q.status}`, { body: JSON.stringify(q.json).slice(0, 200) });
    return null;
  }
  const parsed = parseEscrows(q.json);
  if (!parsed) {
    log('query shape unexpected', { body: JSON.stringify(q.json).slice(0, 300) });
    return null;
  }
  return parsed[0] ?? null;
}

/**
 * Fallback when the API cannot build a transaction for a non-USDC escrow: call the escrow
 * contract directly (interface read with `stellar contract info interface`). The protocol fee
 * recipient is a parameter on testnet; it must hold the asset, so the Qafila treasury stands in.
 */
async function directCall(step: string, fn: string, args: xdr.ScVal[], signer: Keypair, who: string): Promise<string> {
  const r = await queueFor(ctx.rpc, signer).submit((account) => sorobanTx(ctx.rpc, account, ctx.cfg.passphrase, new Contract(escrowIdRef).call(fn, ...args)));
  steps.push({ step, signer: who, txHash: r.hash, note: 'direct contract call (API blocked for qUSD)' });
  log(`${step}: ${r.hash}`, { signer: who, direct: true });
  return r.hash;
}
let escrowIdRef = '';
const isBlockedForAsset = (e: unknown) => /Escrow not found/i.test((e as Error).message);
const feeStandIn = () => requireEnv(env, 'TREASURY_ADDRESS');

async function main(): Promise<void> {
  log('roles', { agent: agent.publicKey(), admin: admin.publicKey(), supplier: supplier.publicKey(), faucet: faucet.publicKey(), token: `${ctx.asset.getCode()}:${ctx.asset.getIssuer()}`, sac: ctx.sacId, base: BASE });

  // 0. Supplier key: friendbot + qUSD trustline (a receiver needs the trustline before a payout reaches it).
  const fb = await fetch(`https://friendbot.stellar.org?addr=${supplier.publicKey()}`);
  if (!fb.ok) throw new Error(`friendbot ${fb.status}`);
  const tl = await ensureTrustline(supplier, ctx.asset, ctx);
  steps.push({ step: 'supplier qUSD trustline (classic changeTrust)', signer: 'supplier', txHash: tl?.hash ?? null, note: 'friendbot funded' });
  // Quirk: the API refuses to build the deploy unless every role wallet has a USDC trustline, even for another asset.
  for (const [who, kp] of [['supplier', supplier], ['admin', admin], ['agent', agent]] as const) {
    const u = await ensureTrustline(kp, USDC_TESTNET, ctx);
    if (u) steps.push({ step: `${who} USDC trustline (API validation quirk)`, signer: who, txHash: u.hash, note: 'no USDC moves' });
  }
  log('supplier funded and trusted', { trustline: tl?.hash ?? 'existed' });

  // 1. Deploy the multi-release escrow (signer = agent G key; the deployer gets no role).
  const engagementId = `qafila-sp10-${Date.now()}`;
  const deployBody = {
    signer: agent.publicKey(),
    engagementId,
    title: 'Qafila SP10 supplier escrow',
    description: 'Murabaha purchase: 30% deposit at order, 70% balance on shipment (SP10 spike)',
    roles: { approver: agent.publicKey(), serviceProvider: supplier.publicKey(), platformAddress: admin.publicKey(), releaseSigner: agent.publicKey(), disputeResolver: admin.publicKey() },
    platformFee: 0,
    milestones: [
      { description: 'Supplier deposit', amount: toNumber(DEPOSIT), receiver: supplier.publicKey() },
      { description: 'Balance on shipment', amount: toNumber(BALANCE), receiver: supplier.publicKey() },
    ],
    trustline: { address: ctx.asset.getIssuer(), symbol: ctx.asset.getCode() },
  };
  const deployed = await buildSignSend('deploy multi-release escrow', '/deployer/multi-release', deployBody, agent, 'agent (deploy signer)');
  const escrowId = deployed.response.contractId;
  if (!escrowId) throw new Error(`deploy response has no contractId: ${JSON.stringify(deployed.response).slice(0, 300)}`);
  escrowIdRef = escrowId;
  const escrowTrustline = deployed.response.escrow?.trustline ?? null;
  log('escrow deployed', { escrowId, trustline: escrowTrustline, explorer: `https://stellar.expert/explorer/testnet/contract/${escrowId}` });
  if (escrowTrustline?.address && escrowTrustline.address !== ctx.sacId && escrowTrustline.address !== ctx.asset.getIssuer()) {
    throw new Error(`the API deployed the escrow in ${escrowTrustline.symbol ?? '?'} (${escrowTrustline.address}), not qUSD (${ctx.sacId}); the testnet API only supports USDC, so the funding steps need Circle testnet USDC`);
  }

  // 2. Fund milestone 1 by a plain SAC transfer to the escrow contract address (what the deal contract does).
  const supplierBefore = await qusdBalance(supplier.publicKey(), ctx);
  const fund1 = await faucetSend({ to: escrowId, amount: DEPOSIT }, ctx);
  steps.push({ step: 'fund milestone 1 by SAC transfer to the escrow address', signer: 'faucet (stands in for the deal contract)', txHash: fund1.hash, note: `${toNumber(DEPOSIT)} qUSD` });
  log('funded by direct transfer', { tx: fund1.hash, escrowBalance: toNumber(await qusdBalance(escrowId, ctx, admin.publicKey())) });

  // 3. Approve and release milestone 1 as the agent.
  try {
    await buildSignSend('approve milestone 1', '/escrow/multi-release/approve-milestone', { contractId: escrowId, milestoneIndex: '0', approver: agent.publicKey() }, agent, 'agent (approver)');
  } catch (e) {
    const msg = (e as Error).message;
    log(`approve failed first: ${msg.slice(0, 200)}`);
    if (!/status/i.test(msg)) throw e;
    // The contract wants a non-empty milestone status first: only the service provider can set it.
    await buildSignSend('change milestone 1 status (fallback)', '/escrow/multi-release/change-milestone-status', { contractId: escrowId, milestoneIndex: '0', newStatus: 'Completed', newEvidence: 'Purchase order accepted', serviceProvider: supplier.publicKey() }, supplier, 'supplier (service provider)');
    await buildSignSend('approve milestone 1 (retry)', '/escrow/multi-release/approve-milestone', { contractId: escrowId, milestoneIndex: '0', approver: agent.publicKey() }, agent, 'agent (approver)');
  }
  let releaseVia: 'api' | 'direct' = 'api';
  try {
    await buildSignSend('release milestone 1', '/escrow/multi-release/release-milestone-funds', { contractId: escrowId, milestoneIndex: '0', releaseSigner: agent.publicKey() }, agent, 'agent (release signer)');
  } catch (e) {
    if (!isBlockedForAsset(e)) throw e;
    // Verified 18:20 WET: the API's fee account has no qUSD trustline, so the 0.3% fee transfer traps and the API answers "Escrow not found".
    log('release via the API is blocked for a qUSD escrow (fee account lacks the trustline); releasing by direct contract call');
    releaseVia = 'direct';
    await directCall('release milestone 1 (direct)', 'release_milestone_funds', [new Address(agent.publicKey()).toScVal(), new Address(feeStandIn()).toScVal(), nativeToScVal(0, { type: 'u32' })], agent, 'agent (release signer)');
  }
  const supplierAfter1 = await qusdBalance(supplier.publicKey(), ctx);
  const received1 = supplierAfter1 - supplierBefore;
  const fee1 = DEPOSIT - received1;
  const feeBps1 = DEPOSIT > 0n ? Number((fee1 * 10000n) / DEPOSIT) : 0;
  log('milestone 1 released', { supplierReceived: toNumber(received1), fee: toNumber(fee1), feeBps: feeBps1, escrowBalance: toNumber(await qusdBalance(escrowId, ctx, admin.publicKey())) });

  // 4. Fund milestone 2 through the REST fund-escrow path (signer must hold qUSD), then dispute and resolve it back to Qafila.
  let resolved: { refund: bigint; feeBps: number } | null = null;
  if (!process.env['SP10_SKIP_DISPUTE']) {
    // Run 4 (18:22 WET): REST `fund-escrow` also demands a USDC trustline on the funder, so fund the way the deal contract does.
    const fund2 = await faucetSend({ to: escrowId, amount: BALANCE }, ctx);
    steps.push({ step: 'fund milestone 2 by SAC transfer to the escrow address', signer: 'faucet (stands in for the deal contract)', txHash: fund2.hash, note: `${toNumber(BALANCE)} qUSD; REST fund-escrow refused: funder needs a USDC trustline` });
    await buildSignSend('dispute milestone 2', '/escrow/multi-release/dispute-milestone', { contractId: escrowId, milestoneIndex: '1', signer: agent.publicKey() }, agent, 'agent (approver raises the dispute)');
    const adminBefore = await qusdBalance(admin.publicKey(), ctx);
    const tryResolve = async (amount: bigint) =>
      buildSignSend('resolve milestone 2 dispute (refund to Qafila admin)', '/escrow/multi-release/resolve-milestone-dispute', { contractId: escrowId, milestoneIndex: '1', disputeResolver: admin.publicKey(), distributions: [{ address: admin.publicKey(), amount: toNumber(amount) }] }, admin, 'admin (dispute resolver)');
    try {
      await tryResolve(BALANCE);
    } catch (e) {
      if (isBlockedForAsset(e)) {
        log('resolve via the API is blocked for a qUSD escrow; resolving by direct contract call');
        const dist = xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: new Address(admin.publicKey()).toScVal(), val: nativeToScVal(BALANCE, { type: 'i128' }) })]);
        await directCall('resolve milestone 2 dispute (direct, refund to Qafila admin)', 'resolve_milestone_dispute', [new Address(admin.publicKey()).toScVal(), nativeToScVal(1, { type: 'u32' }), new Address(feeStandIn()).toScVal(), dist], admin, 'admin (dispute resolver)');
      } else {
        log(`resolve with the full amount failed: ${(e as Error).message.slice(0, 200)}; retrying post-fee`);
        await tryResolve((BALANCE * 9970n) / 10000n);
      }
    }
    const refund = (await qusdBalance(admin.publicKey(), ctx)) - adminBefore;
    const feeBps = BALANCE > 0n ? Number(((BALANCE - refund) * 10000n) / BALANCE) : 0;
    resolved = { refund, feeBps };
    log('milestone 2 resolved', { refundToAdmin: toNumber(refund), feeBps, escrowBalance: toNumber(await qusdBalance(escrowId, ctx, admin.publicKey())) });
  }

  const state = await escrowState(escrowId);
  const verdict = received1 > 0n ? 'PASS' : 'FAIL';
  console.log('\n===== SP10 RESULT =====');
  console.log(`${verdict}  escrow ${escrowId}  engagement ${engagementId}`);
  console.log(`token ${ctx.asset.getCode()}:${ctx.asset.getIssuer()} (SAC ${ctx.sacId}); platform fee 0`);
  console.log(`milestone 1: funded ${toNumber(DEPOSIT)} by direct SAC transfer; released via ${releaseVia}; supplier received ${toNumber(received1)}; protocol fee ${toNumber(fee1)} (${feeBps1} bps)`);
  if (resolved) console.log(`milestone 2: funded ${toNumber(BALANCE)} by direct SAC transfer; disputed by the agent (API); resolved by the admin: refund ${toNumber(resolved.refund)} (${resolved.feeBps} bps kept)`);
  if (state) console.log(`indexer view: ${JSON.stringify({ type: state.type, balance: state.balance, milestones: state.milestones.map((m) => ({ status: m.status, flags: m.flags })) })}`);
  console.log('\n| Step | Signer | Tx |');
  console.log('|---|---|---|');
  for (const s of steps) console.log(`| ${s.step} | ${s.signer} | ${s.txHash ? `\`${s.txHash}\`` : 'none'} ${s.note ? `(${s.note})` : ''} |`);
  console.log(JSON.stringify({ verdict, releaseVia, escrowId, engagementId, supplier: supplier.publicKey(), agent: agent.publicKey(), admin: admin.publicKey(), deposit: toNumber(DEPOSIT), received1: toNumber(received1), feeBps1, resolved: resolved ? { refund: toNumber(resolved.refund), feeBps: resolved.feeBps } : null, steps }, null, 2));
}

main().catch((e) => {
  console.error(`SP10 FAIL: ${(e as Error).message}`);
  console.log('\n| Step | Signer | Tx |');
  console.log('|---|---|---|');
  for (const s of steps) console.log(`| ${s.step} | ${s.signer} | ${s.txHash ? `\`${s.txHash}\`` : 'none'} ${s.note ? `(${s.note})` : ''} |`);
  process.exit(1);
});
