/**
 * Lender agent (PLAN 7): another lender's agent buys a Qafila verification over x402,
 * pays 0.50 USDC on Stellar testnet through the facilitator (fees sponsored, no XLM
 * needed), polls the free job endpoint, then checks the verifier's signature locally
 * and through the Qafila contract's `verify_attestation` view.
 *
 *   LENDER_AGENT_SECRET=S...   payer key with a USDC trustline and balance (faucet.circle.com)
 *   QAFILA_API_URL             default http://localhost:8787
 *   PACKET                     default data/packets/01
 *
 *   pnpm --filter @qafila/lender-agent start
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { Keypair, rpc as StellarRpc } from '@stellar/stellar-sdk';
import { Client as QafilaClient } from '@qafila/contract-client';
import { SignedReportSchema } from '@qafila/shared';
import { fromHex, verifyAttestation } from '@qafila/shared/attestation';

const API = (process.env['QAFILA_API_URL'] ?? 'http://localhost:8787').replace(/\/$/, '');
const NETWORK = 'stellar:testnet';
const packetDir = resolve(process.env['PACKET'] ?? resolve(import.meta.dirname, '../../../data/packets/01'));
const secret = process.env['LENDER_AGENT_SECRET'];
if (!secret) throw new Error('LENDER_AGENT_SECRET is required (a testnet key holding Circle USDC)');
const payer = Keypair.fromSecret(secret).publicKey();

const signer = createEd25519Signer(secret, NETWORK);
const paidFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: NETWORK, client: new ExactStellarScheme(signer) }] });

const form = JSON.parse(readFileSync(resolve(packetDir, 'form.json'), 'utf8')) as { importer: { name: string; country: string }; supplier: { name_en: string; name_zh?: string; uscc?: string; country: string }; goods_summary: string; entity_name: string; deal_number: number; incoterms?: string; origin_port: string; destination_port: string; destination_country: string; carrier?: string | null; containers?: string[]; bl_number?: string | null; documents: Array<{ type: string; file: string }> };
const fd = new FormData();
fd.append('form', JSON.stringify({ ...form, carrier: form.carrier ?? undefined, bl_number: form.bl_number ?? undefined }));
for (const d of form.documents) {
  const bytes = readFileSync(resolve(packetDir, d.file));
  fd.append(d.type, new Blob([new Uint8Array(bytes)], { type: d.file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' }), d.file);
}

console.log(`lender agent ${payer.slice(0, 6)}… buying a verification of ${packetDir.split('/').slice(-2).join('/')} from ${API}`);
const quote = await fetch(`${API}/x402/v1/verify`, { method: 'POST', body: new FormData() });
console.log(`unpaid call answers ${quote.status}: ${((await quote.json()) as { error?: { message?: string } }).error?.message ?? ''}`);

const t0 = Date.now();
const res = await paidFetch(`${API}/x402/v1/verify`, { method: 'POST', body: fd });
const body = (await res.json()) as { job_id?: string; job_token?: string; error?: unknown };
if (!res.ok || !body.job_id) throw new Error(`verification request failed: ${res.status} ${JSON.stringify(body)}`);
const settle = res.headers.get('payment-response') ?? res.headers.get('x-payment-response');
console.log(`paid: job ${body.job_id} (${Date.now() - t0} ms)${settle ? `; settlement ${Buffer.from(settle, 'base64').toString('utf8').slice(0, 160)}` : ''}`);

let report: ReturnType<typeof SignedReportSchema.parse> | null = null;
for (let i = 0; i < 120; i++) {
  const r = await fetch(`${API}/x402/v1/jobs/${body.job_id}?job_token=${body.job_token}`);
  const j = (await r.json()) as { status: string; error?: string | null; report?: unknown };
  if (j.status === 'done' && j.report) {
    report = SignedReportSchema.parse(j.report);
    break;
  }
  if (j.status === 'failed') throw new Error(`job failed: ${j.error}`);
  process.stdout.write('.');
  await new Promise((r2) => setTimeout(r2, 2000));
}
if (!report) throw new Error('timed out waiting for the report');
console.log(`\nreport: decision=${report.report.decision} risk=${report.report.risk_score} hash=${report.report_hash.slice(0, 16)}… checks=${report.report.checks.length}`);
for (const c of report.report.checks.filter((x) => x.status !== 'pass' && x.status !== 'skipped')) console.log(`  ${c.status.padEnd(11)} ${c.name}: ${c.detail.slice(0, 100)}`);

const local = verifyAttestation(fromHex(report.verifier_public_key), { purpose: report.purpose, networkPassphrase: report.network_passphrase, contractId: report.contract_id, dealId: report.deal_id, payloadHash: fromHex(report.report_hash) }, fromHex(report.signature));
console.log(`local signature check: ${local ? 'VALID' : 'INVALID'} (verifier ${report.verifier_public_key.slice(0, 12)}…)`);

const client = new QafilaClient({ contractId: report.contract_id, networkPassphrase: report.network_passphrase, rpcUrl: process.env['STELLAR_RPC_URL'] ?? 'https://soroban-testnet.stellar.org', publicKey: payer });
try {
  const tx = await client.verify_attestation({ purpose: report.purpose, deal_id: BigInt(report.deal_id), payload_hash: Buffer.from(fromHex(report.report_hash)), sig: Buffer.from(fromHex(report.signature)) });
  const sim = tx.simulation;
  const ok = sim !== undefined && !StellarRpc.Api.isSimulationError(sim);
  console.log(`on-chain verify_attestation on ${report.contract_id.slice(0, 8)}…: ${ok ? 'VALID (simulation succeeded)' : `INVALID (${StellarRpc.Api.isSimulationError(sim!) ? sim!.error.slice(0, 120) : 'no simulation'})`}`);
} catch (e) {
  console.log(`on-chain verify_attestation: INVALID (${(e as Error).message.slice(0, 160)})`);
}
