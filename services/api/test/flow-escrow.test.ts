/**
 * S2 (PLAN 10.1) in mock mode with FF_TRUSTLESS_WORK on: listing deploys the escrow and sets
 * `terms.supplier` to it with the cost grossed up by the fee; the agent pays the deposit and
 * releases milestone 1; the deal detail exposes the escrow; ops can dispute and resolve.
 * Needs DATABASE_URL (local Supabase); skipped otherwise. Runs after flow.test.ts (no file parallelism).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DealDetailSchema, MeSchema, OpsDealDetailSchema, parseAmount } from '@qafila/shared';
import { createApp, type App } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { drain } from '../src/jobs/worker.js';
import { createServices, type Services } from '../src/services.js';

const PACKETS = resolve(import.meta.dirname, '../../../data/packets');
const hasDb = Boolean(process.env['DATABASE_URL']);
const ops = { 'x-dev-user': 'ops-1', 'x-dev-roles': 'ops', 'x-dev-email': 'ops@dev.local' };
const importer = { 'x-dev-user': 'importer-1', 'x-dev-roles': 'importer', 'x-dev-email': 'adewale@dev.local' };
const investorA = { 'x-dev-user': 'investor-a', 'x-dev-roles': 'investor', 'x-dev-email': 'a@dev.local' };
const IMPORTER_WALLET = 'GB67IU7IUZHXWFIKUDBGQTYYXMJEBCQGDSFGIOFY2X5SW24DVY2EXAKN';
const INVESTOR_A = 'GD63K6XCZNBZ57BYYZQOTT5WMG5WVR447XRLBO6CAXUQK7RYIRUE2KR2';
const SUPPLIER = 'GAT237PNUTBSCR3WKOVQBIJOPQKEC4VNTEDJ6U2VFGXD6UDGQUKR4RKY';

function file(packet: string, name: string): Blob {
  return new Blob([new Uint8Array(readFileSync(resolve(PACKETS, packet, name)))], { type: 'application/pdf' });
}

describe.skipIf(!hasDb)('Trustless Work escrow mode in mock (FF_TRUSTLESS_WORK=true)', () => {
  let svc: Services;
  let app: App;
  let dealId = '';
  let onchainId = 0;
  let escrowId = '';

  const json = async (res: Response) => {
    const body = (await res.json()) as unknown;
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
    return body;
  };
  const upload = async (packet: string, name: string, type: string) => {
    const fd = new FormData();
    fd.append('type', type);
    fd.append('file', file(packet, name), name);
    return json(await app.request(`/deals/${dealId}/documents`, { method: 'POST', body: fd, headers: importer }));
  };

  beforeAll(async () => {
    const env = loadEnv({ ...process.env, FF_TRUSTLESS_WORK: 'true' });
    svc = createServices(env);
    for (const t of ['notifications', 'agent_actions', 'incidents', 'audit_log', 'checks', 'reports', 'shipments', 'promises', 'extension_requests', 'supplier_confirmations', 'x402_payments', 'documents', 'onchain_events', 'jobs', 'external_calls', 'indexer_cursor', 'deals', 'importers', 'suppliers', 'profiles', 'policy']) {
      await svc.db.execute(sql.raw(`truncate table "${t}" restart identity cascade`));
    }
    app = createApp(env, svc);
  }, 60_000);

  afterAll(async () => {
    await svc.close();
  });

  it('health shows the escrow adapter in mock mode', async () => {
    const h = (await json(await app.request('/health'))) as { adapters: Record<string, string> };
    expect(h.adapters['trustlesswork']).toBe('mock');
    expect(svc.adapters.trustlesswork?.mode).toBe('mock');
  });

  it('onboards the importer and an investor, creates and verifies a deal', async () => {
    await json(await app.request('/wallet/link', { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ address: IMPORTER_WALLET, kind: 'g_account' }) }));
    await json(await app.request('/kyb', { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ legalName: 'Adewale Trading Ltd', country: 'NG', registrationNumber: 'RC 1456789', documentId: null, displayName: 'Adewale Trading Ltd' }) }));
    const me = MeSchema.parse(await json(await app.request('/me', { headers: importer })));
    await json(await app.request(`/ops/kyc/${me.profile.id}/approve`, { method: 'POST', headers: ops }));
    await json(await app.request('/kyc', { method: 'POST', headers: { ...investorA, 'x-wallet-address': INVESTOR_A, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Investor A', country: 'PT', riskAcknowledged: true }) }));
    const created = (await json(await app.request('/deals', { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ supplier: { nameEn: 'Shenzhen Lanwan Electronics Co., Ltd.', nameZh: '深圳市蓝湾电子有限公司', uscc: '91440300MA5GK2Q7XL', country: 'CN', payoutAddress: SUPPLIER }, goodsSummary: 'Phone accessories: TPU cases, tempered glass protectors, USB-C cables', incoterms: 'FOB', originPort: 'Shenzhen (Yantian)', destinationPort: 'Lagos (Apapa), Nigeria', destinationCountry: 'NG', tenorSecs: 120 }) }))) as { id: string };
    dealId = created.id;
    await upload('01', 'invoice.pdf', 'invoice');
    await upload('01', 'packing_list.pdf', 'packing_list');
    await upload('01', 'business_licence.pdf', 'business_licence');
    await json(await app.request(`/deals/${dealId}/verify`, { method: 'POST', headers: importer }));
    await drain(svc);
    const report = (await json(await app.request(`/deals/${dealId}/report`, { headers: importer }))) as { decision: string };
    expect(report.decision).toBe('approve');
  });

  it('listing deploys the escrow: terms.supplier is the escrow, the cost is grossed up by the fee, the detail exposes it', async () => {
    const p = (await json(await app.request(`/deals/${dealId}/promise`, { method: 'POST', headers: importer }))) as { textHash: string; listingFingerprint: string; security: string };
    const tx = await svc.chain.simulate!.promise(IMPORTER_WALLET, p.listingFingerprint, p.textHash, BigInt(p.security));
    await json(await app.request(`/deals/${dealId}/promise/submitted`, { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ txHash: tx.txHash }) }));
    const listed = (await json(await app.request(`/ops/deals/${dealId}/list`, { method: 'POST', headers: ops }))) as { ok: boolean; txHashes: Record<string, string> };
    expect(listed.txHashes['list']).toMatch(/^[0-9a-f]{64}$/);
    const detail = DealDetailSchema.parse(await json(await app.request(`/deals/${dealId}`)));
    onchainId = detail.onchainId!;
    expect(detail.state).toBe('Listed');
    expect(detail.onchain?.terms.payment_mode).toBe('TrustlessWork');
    expect(detail.escrow).not.toBeNull();
    escrowId = detail.escrow!.id;
    expect(escrowId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(detail.onchain?.terms.supplier).toBe(escrowId);
    expect(detail.escrowId).toBe(escrowId);
    expect(detail.escrow!.fundingAddress).toBe(escrowId);
    expect(detail.escrow!.feeBps).toBe(30);
    expect(BigInt(detail.escrow!.invoiceCost)).toBe(parseAmount('14700'));
    expect(BigInt(detail.cost)).toBe(BigInt(detail.escrow!.grossCost));
    expect(BigInt(detail.cost) - parseAmount('14700')).toBe(BigInt(detail.escrow!.fee));
    expect(BigInt(detail.escrow!.fee)).toBeGreaterThan(0n);
    expect(detail.escrow!.url).toBe(`https://viewer.trustlesswork.com/escrow/${escrowId}`);
    expect(detail.escrow!.milestones.map((m) => m.status)).toEqual(['pending', 'pending']);
    expect(detail.escrow!.milestones[0]!.receiver).toBe(SUPPLIER);
    expect(BigInt(detail.escrow!.milestones[0]!.amount) + BigInt(detail.escrow!.milestones[1]!.amount)).toBe(BigInt(detail.cost));
    expect(detail.escrow!.mode).toBe('mock');
    const opsDetail = OpsDealDetailSchema.parse(await json(await app.request(`/ops/deals/${dealId}`, { headers: ops })));
    expect(opsDetail.audit.some((a) => a.action === 'escrow_deployed')).toBe(true);
  });

  it('after funding, the agent pays the deposit into the escrow and releases milestone 1 to the supplier', async () => {
    const detail = DealDetailSchema.parse(await json(await app.request(`/deals/${dealId}`)));
    const cost = BigInt(detail.cost);
    await svc.chain.simulate!.fund(onchainId, INVESTOR_A, cost);
    await svc.db.insert(svc.db._.fullSchema.jobs).values({ kind: 'index_tick', payload: {} });
    await drain(svc);
    await drain(svc);
    const after = DealDetailSchema.parse(await json(await app.request(`/deals/${dealId}`)));
    expect(after.state).toBe('DepositPaid');
    expect(BigInt(after.onchain!.supplier_paid)).toBe((cost * 3000n) / 10000n);
    expect(after.escrow!.milestones[0]).toMatchObject({ approved: true, released: true });
    expect(after.escrow!.milestones[1]).toMatchObject({ approved: false, released: false });
    const log = (await json(await app.request('/ops/agent', { headers: ops }))) as { actions: Array<{ action: string; decision: string; txHash: string | null }> };
    expect(log.actions.some((a) => a.action === 'pay_supplier_deposit' && a.decision === 'paid')).toBe(true);
    const rel = log.actions.find((a) => a.action === 'escrow_release_1');
    expect(rel?.decision).toBe('paid');
    expect(rel?.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ops can dispute milestone 2 and the resolver cannot take more than the escrow holds', async () => {
    const bad = await app.request(`/ops/deals/${dealId}/escrow/dispute`, { method: 'POST', headers: { ...ops, 'content-type': 'application/json' }, body: JSON.stringify({ milestoneIndex: 1, note: 'x' }) });
    expect(bad.status).toBe(422);
    const disputed = (await json(await app.request(`/ops/deals/${dealId}/escrow/dispute`, { method: 'POST', headers: { ...ops, 'content-type': 'application/json' }, body: JSON.stringify({ milestoneIndex: 1, note: 'Supplier did not ship after the deposit' }) }))) as { ok: boolean; txHash: string };
    expect(disputed.txHash).toMatch(/^[0-9a-f]{64}$/);
    const detail = DealDetailSchema.parse(await json(await app.request(`/deals/${dealId}`)));
    expect(detail.escrow!.milestones[1]!.disputed).toBe(true);
    // Milestone 2 is not funded until the shipment is confirmed, so a resolution has nothing to send yet.
    const res = await app.request(`/ops/deals/${dealId}/escrow/resolve`, { method: 'POST', headers: { ...ops, 'content-type': 'application/json' }, body: JSON.stringify({ milestoneIndex: 1, amount: detail.escrow!.milestones[1]!.amount, note: 'refund to Qafila' }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('escrow_precondition');
    const opsDetail = OpsDealDetailSchema.parse(await json(await app.request(`/ops/deals/${dealId}`, { headers: ops })));
    expect(opsDetail.audit.some((a) => a.action === 'escrow_dispute')).toBe(true);
  });
});
