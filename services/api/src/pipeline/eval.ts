/**
 * `pnpm eval` (PLAN 5.7): runs the 12 packets in data/packets in order against a fresh
 * in-memory fingerprint set, registering approved fingerprints as it goes (so packet 07
 * sees packet 01), prints the table (expected, actual, latency, cost) and exits non-zero
 * unless 12 of 12 match. LLM_MODE=mock replays data/fixtures/llm (CI, offline); live mode
 * records the fixtures.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Keypair } from '@stellar/stellar-sdk';
import { DocumentTypeSchema } from '@qafila/shared';
import { createAdapters } from '../adapters/index.js';
import { loadEnv } from '../env.js';
import { DEFAULT_HALAL_POLICY } from './halal.js';
import { runPipeline } from './run.js';
import { MemoryFingerprintStore, type DealContext, type InputDocument, type PipelineDeps } from './types.js';

const PACKETS_DIR = process.env['PACKETS_DIR'] ?? resolve(import.meta.dirname, '../../../../data/packets');

const FormSchema = z.object({
  deal_number: z.number().int(),
  entity_name: z.string(),
  importer: z.object({ name: z.string(), country: z.string(), address: z.string().optional(), registration_number: z.string().optional() }),
  supplier: z.object({ name_en: z.string(), name_zh: z.string().optional(), uscc: z.string().optional(), country: z.string() }),
  goods_summary: z.string(),
  currency: z.string().optional(),
  incoterms: z.string().optional(),
  origin_port: z.string(),
  destination_port: z.string(),
  destination_country: z.string(),
  carrier: z.string().nullable().optional(),
  containers: z.array(z.string()).optional(),
  bl_number: z.string().nullable().optional(),
  documents: z.array(z.object({ type: DocumentTypeSchema, file: z.string() })),
});

const ExpectedSchema = z.object({
  decision: z.enum(['approve', 'review', 'reject']),
  stage: z.enum(['listing', 'shipment']),
  failing_checks: z.array(z.string()),
  injection_detected: z.boolean().optional(),
  notes: z.string().optional(),
});

interface Row {
  packet: string;
  expected: string;
  actual: string;
  ok: boolean;
  stage: string;
  risk: number;
  latencyMs: number;
  costUsd: number;
  flags: string;
}

async function main(): Promise<void> {
  const env = loadEnv({
    ...process.env,
    ADAPTER_MODE: process.env['ADAPTER_MODE'] ?? 'mock',
    // Fictional demo suppliers only exist in the registry fixtures; ShipsGo and OpenSanctions have no keys.
    REGISTRY_MODE: process.env['REGISTRY_MODE'] ?? 'mock',
    SHIPSGO_MODE: process.env['SHIPSGO_MODE'] ?? 'mock',
    OPENSANCTIONS_MODE: process.env['OPENSANCTIONS_MODE'] ?? 'mock',
    FX_MODE: process.env['FX_MODE'] ?? (process.env['ADAPTER_MODE'] === 'live' ? 'live' : 'mock'),
    REFLECTOR_MODE: process.env['REFLECTOR_MODE'] ?? (process.env['ADAPTER_MODE'] === 'live' ? 'live' : 'mock'),
    LLM_MODE: process.env['LLM_MODE'] ?? (process.env['ADAPTER_MODE'] === 'live' ? 'live' : 'mock'),
  });
  const adapters = createAdapters(env, { record: process.env['LLM_MODE'] === 'live' || process.env['ADAPTER_MODE'] === 'live' });
  const verifier = env.VERIFIER_ED25519_SECRET ?? Keypair.random().secret();
  const deps: PipelineDeps = {
    adapters,
    policy: DEFAULT_HALAL_POLICY,
    fingerprints: new MemoryFingerprintStore(),
    verifierSecret: verifier,
    contractId: env.QAFILA_CONTRACT_ID ?? 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    networkPassphrase: env.NETWORK_PASSPHRASE,
    today: process.env['EVAL_TODAY'] ?? '2026-10-25',
  };
  const only = process.env['PACKETS']?.split(',').map((s) => s.trim()).filter(Boolean);
  const dirs = readdirSync(PACKETS_DIR).filter((d) => /^\d{2}$/.test(d) && (!only || only.includes(d))).sort();
  const rows: Row[] = [];
  const outDir = resolve(PACKETS_DIR, '..', 'eval-output');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(outDir, { recursive: true });
  console.log(`eval: ${dirs.length} packets, llm=${adapters.modes['llm']}, registry=${adapters.modes['registry']}, shipsgo=${adapters.modes['shipsgo']}, opensanctions=${adapters.modes['opensanctions']}, fx=${adapters.modes['fx']}, reflector=${adapters.modes['reflector']}`);

  for (const d of dirs) {
    const dir = resolve(PACKETS_DIR, d);
    const form = FormSchema.parse(JSON.parse(readFileSync(resolve(dir, 'form.json'), 'utf8')));
    const expected = ExpectedSchema.parse(JSON.parse(readFileSync(resolve(dir, 'expected.json'), 'utf8')));
    const ctx: DealContext = {
      dealRef: `packet-${d}`,
      dealNumber: form.deal_number,
      entityName: form.entity_name,
      importer: { name: form.importer.name, country: form.importer.country, address: form.importer.address },
      supplier: { nameEn: form.supplier.name_en, nameZh: form.supplier.name_zh, uscc: form.supplier.uscc, country: form.supplier.country },
      goodsSummary: form.goods_summary,
      currency: form.currency,
      incoterms: form.incoterms,
      originPort: form.origin_port,
      destinationPort: form.destination_port,
      destinationCountry: form.destination_country,
      carrier: form.carrier ?? undefined,
      containers: form.containers,
      blNumber: form.bl_number ?? undefined,
    };
    const docs: InputDocument[] = form.documents.map((x) => ({ type: x.type, filename: x.file, bytes: new Uint8Array(readFileSync(resolve(dir, x.file))) }));
    const t0 = Date.now();
    const listingDocs = docs.filter((x) => x.type !== 'bill_of_lading');
    let result = await runPipeline(ctx, listingDocs, deps, { stage: 'listing' });
    let stage: 'listing' | 'shipment' = 'listing';
    let cost = result.report.cost_usd;
    if (result.report.decision === 'approve' && result.report.listing_fingerprint) await deps.fingerprints.addListing(result.report.listing_fingerprint, ctx.dealRef);
    writeFileSync(resolve(outDir, `${d}-listing.json`), JSON.stringify({ report: result.report, report_hash: result.reportHash, signature: result.signature }, null, 2));
    if (expected.stage === 'shipment' && docs.some((x) => x.type === 'bill_of_lading') && result.report.decision !== 'reject') {
      const ship = await runPipeline(ctx, docs, deps, { stage: 'shipment', priorExtracted: result.extracted, priorIngested: result.ingested });
      cost += ship.report.cost_usd;
      if (ship.report.decision === 'approve' && ship.report.shipment_fingerprint) await deps.fingerprints.addShipment(ship.report.shipment_fingerprint, ctx.dealRef);
      writeFileSync(resolve(outDir, `${d}-shipment.json`), JSON.stringify({ report: ship.report, report_hash: ship.reportHash, signature: ship.signature }, null, 2));
      result = ship;
      stage = 'shipment';
    }
    const latencyMs = Date.now() - t0;
    const actual = result.report.decision;
    const flagged = result.report.checks.filter((c) => c.status === 'fail' || c.status === 'review' || c.status === 'unavailable').map((c) => `${c.name}:${c.status[0]}`);
    const missingExpected = expected.failing_checks.filter((n) => !result.report.checks.some((c) => c.name === n && c.status !== 'pass' && c.status !== 'skipped'));
    const injectionOk = expected.injection_detected ? result.report.injection_attempts.length > 0 : true;
    const ok = actual === expected.decision && missingExpected.length === 0 && injectionOk;
    rows.push({ packet: d, expected: expected.decision, actual, ok, stage, risk: result.report.risk_score, latencyMs, costUsd: cost, flags: [...flagged, ...(missingExpected.length ? [`MISSING:${missingExpected.join('|')}`] : []), ...(injectionOk ? [] : ['MISSING:injection'])].join(' ') });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${d} expected=${expected.decision} actual=${actual} stage=${stage} risk=${result.report.risk_score} ${latencyMs} ms $${cost.toFixed(4)} ${flagged.join(' ')}${missingExpected.length ? ` MISSING:${missingExpected.join('|')}` : ''}${injectionOk ? '' : ' MISSING:injection'}`);
  }

  const passed = rows.filter((r) => r.ok).length;
  const table = [
    '| # | Expected | Actual | Stage | Risk | Latency | Cost (USD) | Result |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.packet} | ${r.expected} | ${r.actual} | ${r.stage} | ${r.risk} | ${(r.latencyMs / 1000).toFixed(1)} s | ${r.costUsd.toFixed(4)} | ${r.ok ? 'pass' : `FAIL ${r.flags}`} |`),
    `| | | | | | ${(rows.reduce((s, r) => s + r.latencyMs, 0) / 1000).toFixed(1)} s | ${rows.reduce((s, r) => s + r.costUsd, 0).toFixed(4)} | ${passed} of ${rows.length} |`,
  ].join('\n');
  console.log('\n' + table + '\n');
  const summary = { ran_at: new Date().toISOString(), llm_mode: adapters.modes['llm'], adapter_modes: adapters.modes, passed, total: rows.length, rows, table };
  writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  if (existsSync(resolve(PACKETS_DIR, '..', 'eval-output'))) writeFileSync(resolve(outDir, 'TABLE.md'), `Eval ${summary.ran_at}, llm=${summary.llm_mode}\n\n${table}\n`);
  if (passed !== rows.length) {
    console.error(`eval: ${passed} of ${rows.length} packets passed`);
    process.exit(1);
  }
  console.log(`eval: ${passed} of ${rows.length} packets passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
