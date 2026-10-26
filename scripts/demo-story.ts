/**
 * Demo stories on the live API and contract (testnet only; refuses mainnet). Runs from the laptop:
 * needs the repo .env (demo importer, investor, supplier and qUSD issuer keys) and ssh to the API box,
 * which signs a one-hour session for the demo profile (the project JWT secret never leaves the server).
 *
 *   pnpm tsx scripts/demo-story.ts hero [--packet 03] [--skip-bl] [--deal <number>]
 *     New deal from data/packets/<packet>: screened live, purchase promise signed with the security
 *     deposit, listed by ops, funded (5% co-invest, then the two demo investors), supplier deposit
 *     paid, bill of lading uploaded and tracked. Stops at DepositPaid so ops can run the shipment
 *     check on camera (--skip-bl stops before the bill of lading, for an importer upload on camera;
 *     --deal continues an approved deal from the promise step).
 *   pnpm tsx scripts/demo-story.ts sweep
 *     Sends what the contract owes to charity (the agent also does this on its tick).
 *   pnpm tsx scripts/demo-story.ts late <dealNumber>
 *     On an Owned deal: the importer signs the sale, repays after the due date, pays the late fee,
 *     every holder claims and the deal closes. Charity receives the late fee.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Asset, Keypair } from '@stellar/stellar-sdk';
import { ONE, adminClient, call, clientFor, ensureTrustline, explorerTxUrl, loadChainEnv, mintQusd, networkConfig, qusdBalance, qusdContext, shareAssetCode, view, viewClient } from '@qafila/chain';
import { readEnvValue } from './lib/env-file.ts';

const API = process.env['QAFILA_API'] ?? 'https://api.qafila.dev';
const SSH = ['-i', `${process.env['HOME']}/.ssh/qafila-api.pem`, '-o', 'StrictHostKeyChecking=no', 'ubuntu@52.17.165.123'];
const DEMO_SUB = '3bba3a99-d0d9-4eb3-a852-e778e1085b69';
const log = (m: string) => console.error(`[story] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const env = loadChainEnv({ reload: true });
const cfg = networkConfig(env);
if (cfg.network === 'mainnet') throw new Error('demo stories never run on mainnet');
const qctx = qusdContext(env);
const secret = (key: string): string => {
  const v = readEnvValue(key) ?? process.env[key];
  if (!v) throw new Error(`${key} missing in .env`);
  return v;
};
const importer = Keypair.fromSecret(secret('DEMO_IMPORTER_SECRET'));
const supplier = Keypair.fromSecret(secret('DEMO_SUPPLIER_SECRET'));
const coinvest = Keypair.fromSecret(secret('COINVEST_SECRET'));
const investorA = Keypair.fromSecret(secret('DEMO_INVESTOR_A_SECRET'));
const investorB = Keypair.fromSecret(secret('DEMO_INVESTOR_B_SECRET'));
const tx = (hash?: string | null) => (hash ? explorerTxUrl(cfg.network, hash) ?? hash : '');
let TOKEN = '';
let contractId = '';

/** One-hour HS256 session of the demo profile, signed on the server; only the token comes back. */
function sessionToken(): string {
  const snippet =
    'const c=require("crypto");const enc=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const now=Math.floor(Date.now()/1000);' +
    'const i=enc({alg:"HS256",typ:"JWT"})+"."+enc({sub:process.argv[1],aud:"authenticated",role:"authenticated",iat:now,exp:now+3600});' +
    'process.stdout.write(i+"."+c.createHmac("sha256",process.argv[2]).update(i).digest("base64url"));';
  const remote = `S=$(grep "^SUPABASE_JWT_SECRET=" /opt/qafila/.env | cut -d= -f2- | tr -d '"'); node -e '${snippet}' ${DEMO_SUB} "$S"`;
  const t = execFileSync('ssh', [...SSH, remote], { encoding: 'utf8' }).trim();
  if (!t.includes('.')) throw new Error('no session token from the server');
  return t;
}

async function api<T = unknown>(path: string, init: { method?: string; json?: unknown; form?: FormData; auth?: boolean } = {}): Promise<T> {
  const method = init.method ?? (init.json !== undefined || init.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (init.auth !== false) headers['authorization'] = `Bearer ${TOKEN}`;
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { method, headers, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined) });
      const text = await res.text();
      if ((res.status === 502 || res.status === 503) && attempt < 6) {
        await sleep(5000);
        continue;
      }
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
      return (text ? JSON.parse(text) : null) as T;
    } catch (e) {
      if (attempt < 6 && String((e as Error).message).includes('fetch failed')) {
        await sleep(5000);
        continue;
      }
      throw e;
    }
  }
}

async function poll<T>(what: string, fn: () => Promise<T | null>, everyMs: number, tries: number): Promise<T> {
  for (let i = 0; i < tries; i++) {
    await sleep(everyMs);
    const v = await fn();
    if (v !== null) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function upload(dealId: string, type: string, file: string): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append('type', type);
  fd.append('file', new Blob([readFileSync(file)], { type: 'application/pdf' }), basename(file));
  const rec = await api<{ id: string }>(`/deals/${dealId}/documents`, { form: fd });
  log(`uploaded ${type} (${rec.id})`);
  return rec;
}

async function ensureQusd(kp: Keypair, need: bigint, label: string): Promise<void> {
  const bal = await qusdBalance(kp.publicKey(), qctx);
  log(`${label} ${kp.publicKey().slice(0, 6)}… holds ${bal / ONE} qUSD, needs ${need / ONE}`);
  if (bal < need) {
    const top = need - bal + 100n * ONE;
    const r = await mintQusd({ to: kp.publicKey(), amount: top }, qctx);
    log(`minted ${top / ONE} test dollars to ${label} ${tx(r.hash)}`);
  }
}

interface Form {
  supplier: { name_en: string; name_zh?: string; uscc?: string; country?: string };
  goods_summary: string;
  origin_port: string;
  destination_port: string;
  destination_country: string;
  incoterms?: string;
  carrier?: string;
  containers?: string[];
  bl_number?: string;
}

async function hero(packet: string, skipBl: boolean, resume?: number): Promise<void> {
  const dir = resolve(import.meta.dirname, '../data/packets', packet);
  const f = JSON.parse(readFileSync(resolve(dir, 'form.json'), 'utf8')) as Form;
  const importerC = clientFor(importer.secret(), env, contractId);
  const vc = viewClient(env, contractId);

  const created = resume
    ? await api<{ id: string; number: number }>(`/importer/deals/${resume}`)
    : await api<{ id: string; number: number }>('/deals', {
    json: {
      supplier: { nameEn: f.supplier.name_en, nameZh: f.supplier.name_zh, uscc: f.supplier.uscc?.length === 18 ? f.supplier.uscc : undefined, country: f.supplier.country ?? 'CN', payoutAddress: supplier.publicKey() },
      goodsSummary: f.goods_summary,
      originPort: f.origin_port,
      destinationPort: f.destination_port,
      destinationCountry: f.destination_country,
      incoterms: f.incoterms,
      carrier: f.carrier,
      tenorSecs: 90 * 86_400,
    },
  });
  log(resume ? `resuming deal ${created.number} (${created.id})` : `deal ${created.number} created from packet ${packet} (${created.id})`);
  if (!resume) {
    for (const [type, file] of [['invoice', 'invoice.pdf'], ['packing_list', 'packing_list.pdf'], ['business_licence', 'business_licence.pdf']] as const) await upload(created.id, type, resolve(dir, file));
    await api(`/deals/${created.id}/verify`, { method: 'POST' });
  }
  const screened = await poll('the screening', async () => {
    const d = await api<{ stage: string; decision?: string | null; riskScore?: number | null }>(`/importer/deals/${created.id}`);
    return ['rejected', 'review', 'approved'].includes(d.stage) ? d : null;
  }, 5000, 60);
  log(`screening: ${screened.stage}, decision ${screened.decision ?? '?'}, risk ${screened.riskScore ?? '?'}`);
  if (screened.stage !== 'approved') throw new Error(`deal ${created.number} is ${screened.stage}: override it in the ops console, then continue by hand from the promise`);

  const p = await api<{ textHash: string; listingFingerprint: string; security: string; cost: string }>(`/deals/${created.id}/promise`, { method: 'POST' });
  const security = BigInt(p.security);
  await ensureQusd(importer, security + 10n * ONE, 'importer');
  const fp = Buffer.from(p.listingFingerprint, 'hex');
  const older = await view(await vc.get_promise({ listing_fingerprint: fp }));
  if (older) {
    if (older.listed) throw new Error(`these documents are already listed as a deal on-chain (promise by ${older.importer.slice(0, 6)}…); use another packet`);
    if (older.importer !== importer.publicKey()) throw new Error(`another importer (${older.importer.slice(0, 6)}…) holds the promise for these documents`);
    const w = await call(importerC, (c) => c.withdraw_promise({ importer: importer.publicKey(), listing_fingerprint: fp }));
    log(`withdrew an older promise on the same documents, ${older.security / ONE} qUSD back ${tx(w.hash)}`);
  }
  const promised = await call(importerC, (c) => c.promise_purchase({ importer: importer.publicKey(), listing_fingerprint: fp, promise_hash: Buffer.from(p.textHash, 'hex'), security }));
  log(`promise signed, ${security / ONE} qUSD locked ${tx(promised.hash)}`);
  await api(`/deals/${created.id}/promise/submitted`, { json: { txHash: promised.hash } });

  const listed = await api<{ txHash: string | null; message: string | null }>(`/ops/deals/${created.id}/list`, { method: 'POST' });
  log(`${listed.message ?? 'listed'} ${tx(listed.txHash)}`);
  const d = await api<{ onchainId: number; cost: string; funded: string }>(`/deals/${created.id}`, { auth: false });
  const ops = await api<{ listing: { issuerPublicKey: string | null } | null }>(`/ops/deals/${created.id}`);
  const issuer = ops.listing?.issuerPublicKey;
  if (!issuer) throw new Error('no share issuer on the listing');
  const dealId = BigInt(d.onchainId);
  const cost = BigInt(d.cost);
  const share = new Asset(shareAssetCode(dealId), issuer);
  const co = (cost * BigInt(env.COINVEST_BPS)) / 10_000n;
  const rest = cost - co;
  const half = rest / 2n;
  for (const [kp, amount, label] of [[coinvest, co, 'co-invest'], [investorA, half, 'investor A'], [investorB, rest - half, 'investor B']] as const) {
    await ensureQusd(kp, amount + 5n * ONE, label);
    await ensureTrustline(kp, share, qctx);
    const r = await call(clientFor(kp.secret(), env, contractId), (c) => c.invest({ investor: kp.publicKey(), deal_id: dealId, amount }));
    log(`${label} funded ${amount / ONE} qUSD ${tx(r.hash)}`);
  }

  const state = async () => (await api<{ onchain: { state: string } | null }>(`/deals/${created.id}`, { auth: false })).onchain?.state ?? '?';
  if ((await state()) === 'Funded') {
    try {
      const dep = await api<{ txHash: string | null }>(`/ops/deals/${created.id}/pay-deposit`, { method: 'POST' });
      log(`supplier deposit paid ${tx(dep.txHash)}`);
    } catch (e) {
      log(`pay-deposit: ${(e as Error).message.slice(0, 160)}; state now ${await state()}`);
    }
  }
  log(`deal ${created.number} is ${await state()}`);

  if (skipBl) {
    log(`stopped before the bill of lading: upload data/packets/${packet}/bill_of_lading.pdf from the importer workspace (carrier ${f.carrier}, B/L ${f.bl_number}, containers ${f.containers?.join(' ')})`);
    return;
  }
  const bl = await upload(created.id, 'bill_of_lading', resolve(dir, 'bill_of_lading.pdf'));
  await api(`/deals/${created.id}/shipment`, { json: { carrier: f.carrier, blNumber: f.bl_number, containers: f.containers, documentId: bl.id } });
  await poll('the shipment check', async () => {
    const items = await api<{ id: string; pendingAction: string | null }[]>('/ops/queue');
    const it = items.find((x) => x.id === created.id);
    return it?.pendingAction === 'confirm_shipment' ? it : null;
  }, 5000, 60);
  const t = await api<{ tracking: { vessel: string | null; statusCode: number | null; pol: string | null; pod: string | null; events: unknown[] } | null }>(`/deals/${created.id}`, { auth: false });
  log(`tracking: ${t.tracking?.vessel ?? '?'} from ${t.tracking?.pol ?? '?'} to ${t.tracking?.pod ?? '?'}, status ${t.tracking?.statusCode ?? '?'}, ${t.tracking?.events.length ?? 0} events`);
  log(`deal ${created.number} waits for the ops shipment check: https://qafila.dev/ops/deals/${created.id} (public page https://qafila.dev/deals/${created.number})`);
}

async function late(number: number): Promise<void> {
  const importerC = clientFor(importer.secret(), env, contractId);
  const admin = adminClient(env, contractId);
  const vc = viewClient(env, contractId);
  const row = (await api<{ id: string; number: number }[]>('/deals', { auth: false })).find((x) => x.number === number);
  if (!row) throw new Error(`deal ${number} is not on the public list`);
  const d = await api<{ onchainId: number; onchain: { state: string } | null }>(`/deals/${row.id}`, { auth: false });
  if (d.onchain?.state !== 'Owned') throw new Error(`deal ${number} is ${d.onchain?.state ?? 'not on-chain'}, not Owned`);
  const dealId = BigInt(d.onchainId);

  const sale = await call(importerC, (c) => c.accept_murabaha({ deal_id: dealId }));
  log(`sale signed by the importer ${tx(sale.hash)}`);
  let on = await view(await vc.get_deal({ deal_id: dealId }));
  const outstanding = on.sale_price - on.principal_repaid;
  const dueAt = Number(on.due_at);
  log(`price ${on.sale_price / ONE} qUSD, deposit counted ${on.principal_repaid / ONE}, outstanding ${outstanding / ONE}, due ${new Date(dueAt * 1000).toISOString()}`);
  const waitMs = (dueAt + 8) * 1000 - Date.now();
  if (waitMs > 0) {
    log(`waiting ${Math.ceil(waitMs / 1000)} s for the due date to pass`);
    await sleep(waitMs);
  }
  await ensureQusd(importer, outstanding + on.terms.late_fee + 10n * ONE, 'importer');
  const rep = await call(importerC, (c) => c.repay({ deal_id: dealId, amount: outstanding }));
  log(`repaid ${outstanding / ONE} qUSD after the due date ${tx(rep.hash)}`);
  on = await view(await vc.get_deal({ deal_id: dealId }));
  const fee = on.late_fee_due - on.late_fee_paid;
  if (fee > 0n) {
    const lf = await call(importerC, (c) => c.pay_late_fee({ deal_id: dealId, amount: fee }));
    log(`late fee ${fee / ONE} qUSD paid, owed to charity ${tx(lf.hash)}`);
  } else log('no late fee due');
  for (const [kp, label] of [[coinvest, 'co-invest'], [investorA, 'investor A'], [investorB, 'investor B']] as const) {
    try {
      const r = await call(clientFor(kp.secret(), env, contractId), (c) => c.claim({ holder: kp.publicKey(), deal_id: dealId }));
      log(`${label} claimed ${(r.result as bigint) / ONE} qUSD ${tx(r.hash)}`);
    } catch (e) {
      log(`${label} claim: ${(e as Error).message.slice(0, 140)}`);
    }
  }
  try {
    const cl = await call(admin, (c) => c.close_deal({ deal_id: dealId }));
    log(`deal closed ${tx(cl.hash)}`);
  } catch (e) {
    log(`close: ${(e as Error).message.slice(0, 140)} (a deal closes once every holder has claimed)`);
  }
  await sweep();
}

/** Sends what the contract owes to charity; the agent does this on its own tick as well. */
async function sweep(): Promise<void> {
  const admin = adminClient(env, contractId);
  try {
    const sent = await admin.queue.run(async () => (await admin.client.sweep_charity()).signAndSend({ force: true }));
    log(`charity sweep sent ${tx(sent.sendTransactionResponse?.hash)}`);
  } catch (e) {
    log(`sweep: ${(e as Error).message.slice(0, 140)}`);
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { packet: { type: 'string', default: '03' }, 'skip-bl': { type: 'boolean', default: false }, deal: { type: 'string' } } });
  const cmd = positionals[0];
  const config = await api<{ network: string; contractId: string; settlementToken: { id: string } }>('/config', { auth: false });
  if (config.network !== cfg.network) throw new Error(`the API is on ${config.network}, this .env on ${cfg.network}`);
  if (config.settlementToken.id !== qctx.sacId) throw new Error('the settlement token in .env differs from the API');
  contractId = config.contractId;
  TOKEN = sessionToken();
  const me = await api<{ profile: { displayName: string; walletAddress: string | null } }>('/me');
  if (me.profile.walletAddress !== importer.publicKey()) throw new Error(`the demo profile wallet ${me.profile.walletAddress} is not DEMO_IMPORTER_SECRET's ${importer.publicKey()}`);
  log(`${me.profile.displayName} on ${cfg.network}, contract ${contractId}`);
  if (cmd === 'hero') await hero(values.packet ?? '03', values['skip-bl'] ?? false, values.deal ? Number(values.deal) : undefined);
  else if (cmd === 'late') await late(Number(positionals[1]));
  else if (cmd === 'sweep') await sweep();
  else throw new Error('usage: demo-story.ts hero [--packet 03] [--skip-bl] [--deal <number>] | late <dealNumber> | sweep');
}

main().catch((err: unknown) => {
  console.error(`[story] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
