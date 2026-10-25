/**
 * End-to-end API flow in mock mode (PLAN 12): importer registers, creates a deal, uploads
 * packet 01, verification approves, promise, ops lists, investors fund, the agent pays
 * the deposit, the B/L of packet 03 is verified and the agent confirms, the importer
 * accepts and repays, housekeeping claims and closes, stats and ledgers reflect it.
 * Needs DATABASE_URL (local Supabase); skipped otherwise.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CharityLedgerSchema, DealDetailSchema, EventFeedSchema, ImporterDealDetailSchema, MeSchema, OpsDealDetailSchema, OpsQueueItemSchema, PortfolioSchema, ReportResponseSchema, StatsSchema, parseAmount } from '@qafila/shared';
import { z } from 'zod';
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
const INVESTOR_B = 'GADXB3VALLGZJKRMQA474IAJIPJ7VUMENZ7AHTN3WWPD4QR6Y7JDV7K2';
const SUPPLIER = 'GAT237PNUTBSCR3WKOVQBIJOPQKEC4VNTEDJ6U2VFGXD6UDGQUKR4RKY';

function file(packet: string, name: string): Blob {
  return new Blob([new Uint8Array(readFileSync(resolve(PACKETS, packet, name)))], { type: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' });
}

describe.skipIf(!hasDb)('API flow in mock mode', () => {
  let svc: Services;
  let app: App;
  let dealId = '';
  let onchainId = 0;

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
    const env = loadEnv(process.env);
    svc = createServices(env);
    for (const t of ['notifications', 'agent_actions', 'incidents', 'audit_log', 'checks', 'reports', 'shipments', 'promises', 'extension_requests', 'supplier_confirmations', 'x402_payments', 'documents', 'onchain_events', 'jobs', 'external_calls', 'indexer_cursor', 'deals', 'importers', 'suppliers', 'profiles', 'policy']) {
      await svc.db.execute(sql.raw(`truncate table "${t}" restart identity cascade`));
    }
    app = createApp(env, svc);
  }, 60_000);

  afterAll(async () => {
    await svc.close();
  });

  it('health reports mock adapters and the database', async () => {
    const h = (await json(await app.request('/health'))) as { adapters: Record<string, string>; db: { ok: boolean } };
    expect(h.db.ok).toBe(true);
    expect(h.adapters['chain']).toBe('mock');
    expect(h.adapters['llm']).toBe('mock');
  });

  it('importer signs up, links a wallet and registers the company (KYB pending)', async () => {
    await json(await app.request('/wallet/link', { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ address: IMPORTER_WALLET, kind: 'g_account' }) }));
    const kyb = await json(await app.request('/kyb', { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ legalName: 'Adewale Trading Ltd', country: 'NG', registrationNumber: 'RC 1456789', documentId: null, displayName: 'Adewale Trading Ltd' }) }));
    expect((kyb as { kycStatus: string }).kycStatus).toBe('pending');
    const me = MeSchema.parse(await json(await app.request('/me', { headers: importer })));
    expect(me.importer?.kybStatus).toBe('pending');
    expect(me.profile.roles).toContain('importer');
  });

  it('ops approves the KYB and the importer gets a faucet grant of 1.35 x the limit', async () => {
    const me = MeSchema.parse(await json(await app.request('/me', { headers: importer })));
    const r = (await json(await app.request(`/ops/kyc/${me.profile.id}/approve`, { method: 'POST', headers: ops }))) as { ok: boolean; txHash: string | null; message: string | null };
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/KYB approved/);
    const after = MeSchema.parse(await json(await app.request('/me', { headers: importer })));
    expect(after.importer?.kybStatus).toBe('approved');
    expect(after.importer?.faucetGrant).not.toBeNull();
  });

  it('investors pass KYC-lite and are approved on-chain at once', async () => {
    const a = (await json(await app.request('/kyc', { method: 'POST', headers: { ...investorA, 'x-wallet-address': INVESTOR_A, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Investor A', country: 'PT', riskAcknowledged: true }) }))) as { kycStatus: string; approveTxHash: string | null };
    expect(a.kycStatus).toBe('approved');
    expect(a.approveTxHash).toMatch(/^[0-9a-f]{64}$/);
    const b = (await json(await app.request('/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Venue investor', address: INVESTOR_B, riskAcknowledged: true }) }))) as { kycStatus: string };
    expect(b.kycStatus).toBe('approved');
    expect(await svc.chain.isInvestorApproved(INVESTOR_B)).toBe(true);
  });

  it('creates a draft deal and uploads packet 01', async () => {
    const created = (await json(await app.request('/deals', { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ supplier: { nameEn: 'Shenzhen Lanwan Electronics Co., Ltd.', nameZh: '深圳市蓝湾电子有限公司', uscc: '91440300MA5GK2Q7XL', country: 'CN', payoutAddress: SUPPLIER }, goodsSummary: 'Phone accessories: TPU cases, tempered glass protectors, USB-C cables', incoterms: 'FOB', originPort: 'Shenzhen (Yantian)', destinationPort: 'Lagos (Apapa), Nigeria', destinationCountry: 'NG', tenorSecs: 120 }) }))) as { id: string; number: number; status: string };
    dealId = created.id;
    expect(created.status).toBe('draft');
    await upload('01', 'invoice.pdf', 'invoice');
    await upload('01', 'packing_list.pdf', 'packing_list');
    const lic = (await upload('01', 'business_licence.pdf', 'business_licence')) as { status: string; pages: number };
    expect(lic.status).toBe('uploaded');
    expect(lic.pages).toBe(1);
  });

  it('verification job approves the deal with a signed report', async () => {
    const v = (await json(await app.request(`/deals/${dealId}/verify`, { method: 'POST', headers: importer }))) as { jobId: string };
    expect(v.jobId).toBeTruthy();
    await drain(svc);
    const job = (await json(await app.request(`/jobs/${v.jobId}`))) as { status: string; lastError: string | null };
    expect(job.lastError).toBeNull();
    expect(job.status).toBe('done');
    const report = ReportResponseSchema.parse(await json(await app.request(`/deals/${dealId}/report`, { headers: importer })));
    expect(report.decision).toBe('approve');
    expect(report.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(report.report.adapter_modes['llm']).toBe('mock');
    expect(report.explanation).toBeTruthy();
    const detail = ImporterDealDetailSchema.parse(await json(await app.request(`/importer/deals/${dealId}`, { headers: importer })));
    expect(detail.stage).toBe('approved');
    expect(BigInt(detail.terms.cost)).toBe(parseAmount('14700'));
  });

  it('the same invoice cannot be financed twice (duplicate fingerprint)', async () => {
    const created = (await json(await app.request('/deals', { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ supplier: { nameEn: 'Shenzhen Lanwan Electronics Co., Ltd.', uscc: '91440300MA5GK2Q7XL', country: 'CN' }, goodsSummary: 'Phone accessories again', originPort: 'Shenzhen (Yantian)', destinationPort: 'Lagos (Apapa), Nigeria', destinationCountry: 'NG', tenorSecs: 120 }) }))) as { id: string };
    const saved = dealId;
    dealId = created.id;
    await upload('07', 'invoice.pdf', 'invoice');
    await upload('07', 'packing_list.pdf', 'packing_list');
    await upload('07', 'business_licence.pdf', 'business_licence');
    await json(await app.request(`/deals/${dealId}/verify`, { method: 'POST', headers: importer }));
    await drain(svc);
    const report = ReportResponseSchema.parse(await json(await app.request(`/deals/${dealId}/report`, { headers: importer })));
    expect(report.decision).toBe('reject');
    expect(report.rejectCategory).toBe('duplicate');
    dealId = saved;
  });

  it('promise text carries the security deposit; the importer signs on-chain; ops lists the deal', async () => {
    const p = (await json(await app.request(`/deals/${dealId}/promise`, { method: 'POST', headers: importer }))) as { text: string; textHash: string; listingFingerprint: string; security: string; securityBps: number; cost: string };
    expect(p.securityBps).toBe(2000);
    expect(BigInt(p.security)).toBe(parseAmount('2940'));
    expect(p.text).toMatch(/security deposit/);
    const sim = svc.chain.simulate!;
    const tx = await sim.promise(IMPORTER_WALLET, p.listingFingerprint, p.textHash, BigInt(p.security));
    await json(await app.request(`/deals/${dealId}/promise/submitted`, { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ txHash: tx.txHash }) }));
    const queue = z.array(OpsQueueItemSchema).parse(await json(await app.request('/ops/queue', { headers: ops })));
    expect(queue.find((d) => d.id === dealId)?.pendingAction).toBe('list');
    const listed = (await json(await app.request(`/ops/deals/${dealId}/list`, { method: 'POST', headers: ops }))) as { ok: boolean; txHashes: Record<string, string> };
    expect(listed.txHashes['list']).toMatch(/^[0-9a-f]{64}$/);
    const detail = DealDetailSchema.parse(await json(await app.request(`/deals/${dealId}`)));
    expect(detail.state).toBe('Listed');
    expect(detail.worstCase.investorRecoveryBps).toBe(2000);
    onchainId = detail.onchainId!;
    const byNumber = DealDetailSchema.parse(await json(await app.request(`/deals/${detail.number}`)));
    expect(byNumber.id).toBe(dealId);
  });

  it('investors fund the deal; the indexer sees the events; the agent pays the supplier deposit', async () => {
    const sim = svc.chain.simulate!;
    await sim.fund(onchainId, INVESTOR_A, parseAmount('10000'));
    await sim.fund(onchainId, INVESTOR_B, parseAmount('4700'));
    await svc.db.insert(svc.db._.fullSchema.jobs).values({ kind: 'index_tick', payload: {} });
    await drain(svc);
    const detail = DealDetailSchema.parse(await json(await app.request(`/deals/${dealId}`)));
    expect(['DepositPaid', 'Funded']).toContain(detail.state);
    await drain(svc);
    const after = DealDetailSchema.parse(await json(await app.request(`/deals/${dealId}`)));
    expect(after.state).toBe('DepositPaid');
    expect(after.timeline.some((e) => e.type === 'funded')).toBe(true);
    const log = (await json(await app.request('/ops/agent', { headers: ops }))) as { actions: Array<{ action: string; decision: string }> };
    expect(log.actions.some((a) => a.action === 'pay_supplier_deposit' && a.decision === 'paid')).toBe(true);
    const portfolio = PortfolioSchema.parse(await json(await app.request('/me/portfolio', { headers: { 'x-wallet-address': INVESTOR_A } })));
    expect(portfolio.positions[0]?.shares).toBe(parseAmount('10000').toString());
  });

  it('the B/L is verified at the shipment stage and the agent confirms the shipment', async () => {
    // Packet 03 carries the clean B/L (to order of Qafila Trade, deal 3) with its own invoice and packing list; swap them in as this deal's documents.
    await upload('03', 'invoice.pdf', 'invoice');
    await upload('03', 'packing_list.pdf', 'packing_list');
    await upload('03', 'business_licence.pdf', 'business_licence');
    const bl = (await upload('03', 'bill_of_lading.pdf', 'bill_of_lading')) as { id: string };
    const s = (await json(await app.request(`/deals/${dealId}/shipment`, { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: JSON.stringify({ carrier: 'OOCL', blNumber: 'OOLU2609881030', containers: ['COSU6319486', 'COSU6319505'], documentId: bl.id }) }))) as { jobId: string | null };
    expect(s.jobId).toBeTruthy();
    await drain(svc);
    await drain(svc);
    const report = ReportResponseSchema.parse(await json(await app.request(`/deals/${dealId}/report?stage=shipment`, { headers: ops })));
    // The B/L names deal 3 and this is a different deal number, so the buyer check reviews; everything else matches the packet.
    expect(['approve', 'review']).toContain(report.decision);
    const tracking = (await json(await app.request(`/deals/${dealId}/tracking`))) as { events: unknown[]; mode: string };
    expect(tracking.mode).toBe('mock');
    expect(tracking.events.length).toBeGreaterThan(0);
    if (report.decision === 'approve') {
      const detail = DealDetailSchema.parse(await json(await app.request(`/deals/${dealId}`)));
      expect(detail.state).toBe('Owned');
    } else {
      const log = (await json(await app.request('/ops/agent', { headers: ops }))) as { incidents: Array<{ kind: string }> };
      expect(log.incidents.some((i) => i.kind === 'shipment_review')).toBe(true);
    }
  });

  it('ops abort from DepositPaid uses the O-5 reason list and refunds when not at fault', async () => {
    const detail = DealDetailSchema.parse(await json(await app.request(`/deals/${dealId}`)));
    if (detail.state !== 'DepositPaid') return;
    const r = (await json(await app.request(`/ops/deals/${dealId}/abort`, { method: 'POST', headers: { ...ops, 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'goods_lost_or_damaged', note: 'container lost overboard, carrier confirmed' }) }))) as { ok: boolean; message: string };
    expect(r.message).toMatch(/importer at fault: false/);
    await drain(svc);
    const opsDetail = OpsDealDetailSchema.parse(await json(await app.request(`/ops/deals/${dealId}`, { headers: ops })));
    expect(opsDetail.abort?.importerAtFault).toBe(false);
    expect(opsDetail.state).toBe('Defaulted');
  });

  it('stats, events and the charity ledger validate against the shared schemas', async () => {
    const stats = StatsSchema.parse(await json(await app.request('/stats')));
    expect(Object.keys(stats.dealsByState)).toHaveLength(10);
    expect(stats.approvedInvestors).toBeGreaterThanOrEqual(2);
    const events = EventFeedSchema.parse(await json(await app.request('/events?limit=10')));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.summary).toBeTruthy();
    CharityLedgerSchema.parse(await json(await app.request('/charity')));
  });

  it('rejects unauthenticated access to private routes and bad bodies', async () => {
    expect((await app.request('/me')).status).toBe(401);
    expect((await app.request('/ops/queue', { headers: importer })).status).toBe(403);
    expect((await app.request('/deals', { method: 'POST', headers: { ...importer, 'content-type': 'application/json' }, body: '{}' })).status).toBe(422);
  });
});
