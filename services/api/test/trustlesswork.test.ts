/** S2 Trustless Work adapter: fee math, the mock escrow's contract-like preconditions, env wiring, and the recorded SP10 record. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAdapters } from '../src/adapters/index.js';
import { EscrowRecordSchema, TrustlessWorkError, apiAmountToStroops, escrowPlan, grossUp, makeTrustlessWork, netOfFee, stroopsToApiAmount, toEscrowState } from '../src/adapters/trustlesswork.js';
import { loadEnv } from '../src/env.js';

const ONE = 10_000_000n;
const agent = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 12));
const admin = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11));
const supplier = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 13));
const stranger = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 14));
const roles = { approver: agent.publicKey(), serviceProvider: supplier.publicKey(), platformAddress: admin.publicKey(), releaseSigner: agent.publicKey(), disputeResolver: admin.publicKey() };
const asset = { issuer: 'GDZE4PY2VVPCOTERMIETEB73XA5KDHI25ZGDAINMCTEXYBJCG76H63VA', code: 'qUSD' };

describe('escrow fee math (SP10: 0.3% of every payout)', () => {
  it('grosses up so the receiver nets at least the invoice', () => {
    for (const invoice of [1n, 999n, 30n * ONE, 14700n * ONE, 123_456_789n]) {
      const gross = grossUp(invoice, 30);
      expect(netOfFee(gross, 30)).toBeGreaterThanOrEqual(invoice);
      expect(netOfFee(gross - 1n, 30)).toBeLessThan(invoice);
    }
    expect(grossUp(100n * ONE, 0)).toBe(100n * ONE);
    expect(grossUp(0n, 30)).toBe(0n);
  });

  it('matches the SP10 observation: 30 qUSD pays 29.91, fee 0.09', () => {
    expect(netOfFee(30n * ONE, 30)).toBe(2991n * 100_000n);
    expect(30n * ONE - netOfFee(30n * ONE, 30)).toBe(9n * 100_000n);
  });

  it('plans the two milestones the way the contract splits the cost', () => {
    const plan = escrowPlan(14700n * ONE, 3000, 30);
    expect(plan.grossCost).toBeGreaterThan(14700n * ONE);
    expect(plan.deposit).toBe((plan.grossCost * 3000n) / 10000n);
    expect(plan.deposit + plan.balance).toBe(plan.grossCost);
    expect(plan.fee).toBe(plan.grossCost - 14700n * ONE);
    expect(plan.supplierNet).toBeGreaterThanOrEqual(14700n * ONE - 1n); // two floors may lose one stroop of dust
    expect(plan.supplierNet).toBeLessThan(14700n * ONE + 2n * ONE);
    const native = escrowPlan(10000n * ONE, 3000, 0);
    expect(native.grossCost).toBe(10000n * ONE);
    expect(native.fee).toBe(0n);
  });

  it('converts stroops to the API number and back', () => {
    expect(stroopsToApiAmount(30n * ONE)).toBe(30);
    expect(stroopsToApiAmount(2991n * 100_000n)).toBe(29.91);
    expect(apiAmountToStroops(29.91)).toBe(2991n * 100_000n);
  });
});

describe('recorded SP10 escrow record', () => {
  it('parses and maps to the escrow state', () => {
    const file = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../data/fixtures/trustlesswork/escrow-sp10.json'), 'utf8')) as { response: unknown };
    const parsed = z.array(EscrowRecordSchema).parse(file.response);
    const state = toEscrowState(parsed[0]!);
    expect(state.contractId).toBe('CCYBZTQGKQBXU7NT6RDC3ZFGBGAZ5MNDPUKXKYSM3BWNO5U6CQMZKWAR');
    expect(state.trustline.symbol).toBe('qUSD');
    expect(state.trustline.contractId).toBe('CB7WLKU45NHMLECCZGP5H6RH5IHMSHJXA7U4JSNM4MQT7WT46LZMC3KZ');
    expect(state.milestones).toHaveLength(2);
    expect(state.milestones[0]).toMatchObject({ index: 0, amount: 30n * ONE, approved: true, released: false });
    expect(state.milestones[1]).toMatchObject({ index: 1, amount: 70n * ONE, approved: false });
    expect(state.balance).toBe(30n * ONE);
    expect(state.platformFee).toBe(0);
  });
});

describe('mock escrow follows the contract preconditions', () => {
  const tw = makeTrustlessWork({ mode: 'mock', networkPassphrase: 'Test SDF Network ; September 2015' });
  const deploy = () => tw.deploy({ signer: admin, engagementId: `t-${Math.random()}`, title: 't', description: 'd', roles, milestones: [{ description: 'deposit', amount: 30n * ONE, receiver: supplier.publicKey() }, { description: 'balance', amount: 70n * ONE, receiver: supplier.publicKey() }], asset });

  it('deploys to a contract address with a 64-hex tx hash and two pending milestones', async () => {
    const d = await deploy();
    expect(d.mode).toBe('mock');
    expect(d.escrowId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(d.txHash).toMatch(/^[0-9a-f]{64}$/);
    const s = await tw.getEscrow(d.escrowId);
    expect(s?.milestones.map((m) => m.status)).toEqual(['pending', 'pending']);
    expect(s?.roles.releaseSigner).toBe(agent.publicKey());
    expect(tw.viewerUrl(d.escrowId)).toBe(`https://viewer.trustlesswork.com/escrow/${d.escrowId}`);
  });

  it('refuses a zero milestone and an unknown escrow', async () => {
    await expect(tw.deploy({ signer: admin, engagementId: 'zero', title: 't', description: 'd', roles, milestones: [{ description: 'x', amount: 0n, receiver: supplier.publicKey() }], asset })).rejects.toMatchObject({ code: 'precondition' });
    await expect(tw.getEscrow('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB')).resolves.toBeNull();
    await expect(tw.approveMilestone('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB', 0, agent)).rejects.toBeInstanceOf(TrustlessWorkError);
  });

  it('only the approver approves, only the release signer releases, and only after approval and funding', async () => {
    const { escrowId } = await deploy();
    await expect(tw.releaseMilestone(escrowId, 0, agent)).rejects.toMatchObject({ code: 'precondition' });
    await expect(tw.approveMilestone(escrowId, 0, stranger)).rejects.toMatchObject({ code: 'precondition' });
    const ap = await tw.approveMilestone(escrowId, 0, agent);
    expect(ap.txHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(tw.approveMilestone(escrowId, 0, agent)).rejects.toThrow(/already been approved/);
    await expect(tw.releaseMilestone(escrowId, 0, agent)).rejects.toThrow(/balance/);
    tw.mockFund!(escrowId, 30n * ONE);
    await expect(tw.releaseMilestone(escrowId, 0, stranger)).rejects.toThrow(/release signer/);
    const rel = await tw.releaseMilestone(escrowId, 0, agent);
    expect(rel.mode).toBe('mock');
    const s = await tw.getEscrow(escrowId);
    expect(s?.milestones[0]).toMatchObject({ approved: true, released: true, status: 'released' });
    expect(s?.balance).toBe(0n);
    await expect(tw.releaseMilestone(escrowId, 0, agent)).rejects.toThrow(/already released/);
  });

  it('dispute and resolve: the resolver cannot dispute, the agent can, the resolver refunds within the milestone', async () => {
    const { escrowId } = await deploy();
    tw.mockFund!(escrowId, 100n * ONE);
    await expect(tw.disputeMilestone(escrowId, 1, admin)).rejects.toThrow(/resolver cannot/);
    await expect(tw.disputeMilestone(escrowId, 1, stranger)).rejects.toThrow(/not authorized/);
    await expect(tw.resolveMilestoneDispute(escrowId, 1, admin, [{ address: admin.publicKey(), amount: 70n * ONE }])).rejects.toThrow(/not in dispute/);
    await tw.disputeMilestone(escrowId, 1, agent);
    await expect(tw.disputeMilestone(escrowId, 1, agent)).rejects.toThrow(/already in dispute/);
    await expect(tw.releaseMilestone(escrowId, 1, agent)).rejects.toThrow(/dispute/);
    await expect(tw.resolveMilestoneDispute(escrowId, 1, agent, [{ address: admin.publicKey(), amount: 70n * ONE }])).rejects.toThrow(/dispute resolver/);
    await expect(tw.resolveMilestoneDispute(escrowId, 1, admin, [{ address: admin.publicKey(), amount: 71n * ONE }])).rejects.toThrow(/exceed/);
    const r = await tw.resolveMilestoneDispute(escrowId, 1, admin, [{ address: admin.publicKey(), amount: 70n * ONE }]);
    expect(r.txHash).toMatch(/^[0-9a-f]{64}$/);
    const s = await tw.getEscrow(escrowId);
    expect(s?.milestones[1]).toMatchObject({ disputed: false, resolved: true });
    expect(s?.balance).toBe(30n * ONE);
  });
});

describe('adapter wiring', () => {
  it('is off without the flag and mock with the flag in mock mode', () => {
    const off = createAdapters(loadEnv({ ADAPTER_MODE: 'mock', STELLAR_NETWORK: 'testnet' }), { record: false });
    expect(off.trustlesswork).toBeNull();
    expect(off.modes['trustlesswork']).toBe('off');
    const on = createAdapters(loadEnv({ ADAPTER_MODE: 'mock', STELLAR_NETWORK: 'testnet', FF_TRUSTLESS_WORK: 'true' }), { record: false });
    expect(on.trustlesswork?.mode).toBe('mock');
    expect(on.trustlesswork?.feeBps).toBe(30);
    expect(on.modes['trustlesswork']).toBe('mock');
  });

  it('live mode without a key falls back to mock; with a key it is live', () => {
    const noKey = createAdapters(loadEnv({ ADAPTER_MODE: 'live', STELLAR_NETWORK: 'testnet', FF_TRUSTLESS_WORK: 'true' }), { record: false });
    expect(noKey.trustlesswork?.mode).toBe('mock');
    const live = createAdapters(loadEnv({ ADAPTER_MODE: 'live', STELLAR_NETWORK: 'testnet', FF_TRUSTLESS_WORK: 'true', TRUSTLESS_WORK_API_KEY: 'k', TRUSTLESS_WORK_FEE_BPS: '30' }), { record: false });
    expect(live.trustlesswork?.mode).toBe('live');
    expect(live.modes['trustlesswork']).toBe('live');
  });
});
