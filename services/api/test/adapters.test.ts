import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadEnv } from '../src/env.js';
import { createAdapters } from '../src/adapters/index.js';
import { adapterContext, defineAdapter, MemoryCache } from '../src/adapters/base.js';
import { mapShipsgo } from '../src/adapters/shipsgo.js';
import { qccHeaders, normaliseQccStatus } from '../src/adapters/qcc.js';
import { fillDefaults, toolInputSchema } from '../src/adapters/llm.js';

const env = loadEnv({ ADAPTER_MODE: 'mock', STELLAR_NETWORK: 'testnet' });
const a = createAdapters(env, { record: false });

describe('adapters in mock mode replay recorded fixtures', () => {
  it('all modes are mock without keys', () => {
    expect(a.modes['llm']).toBe('mock');
    expect(a.modes['registry']).toBe('mock');
    expect(a.modes['shipsgo']).toBe('mock');
    expect(a.modes['opensanctions']).toBe('mock');
    expect(a.modes['qcc']).toBe('off');
    expect(a.storage.mode).toBe('local');
  });

  it('gleif replays the recorded Huawei record (ACTIVE, ISSUED, CN)', async () => {
    const r = await a.gleif({ uscc: '914403001922038216' }, a.ctx.registry);
    expect(r.status).toBe('ok');
    expect(r.mode).toBe('mock');
    expect(r.fixture).toBe('gleif/914403001922038216.json');
    expect(r.data?.found).toBe(true);
    expect(r.data?.legalNameZh).toBe('华为技术有限公司');
    expect(r.data?.legalNameEn).toBe('Huawei Technologies Co., Ltd.');
    expect(r.data?.entityStatus).toBe('ACTIVE');
    expect(r.data?.leiStatus).toBe('ISSUED');
    expect(r.data?.country).toBe('CN');
  });

  it('gleif replays a recorded miss as found=false', async () => {
    const r = await a.gleif({ uscc: '91440300MA5FXXXX1A' }, a.ctx.registry);
    expect(r.status).toBe('ok');
    expect(r.data?.found).toBe(false);
  });

  it('gleif without a fixture is unavailable, not an error', async () => {
    const r = await a.gleif({ uscc: '91110000000000000X' }, a.ctx.registry);
    expect(r.status).toBe('unavailable');
    expect(r.data).toBeNull();
  });

  it('fx replays the ECB rate for CNY and has nothing for NGN', async () => {
    const cny = await a.fx({ from: 'USD', to: 'CNY' }, a.ctx.fx);
    expect(cny.status).toBe('ok');
    expect(cny.data?.rate).toBeGreaterThan(5);
    expect(cny.data?.source).toBe('ecb');
    const ngn = await a.fx({ from: 'USD', to: 'NGN' }, a.ctx.fx);
    expect(ngn.data ?? null).toBeNull();
  });

  it('reflector replays EUR and returns null for CNY (SP9)', async () => {
    const eur = await a.reflector({ symbol: 'EUR' }, a.ctx.reflector);
    expect(eur.status).toBe('ok');
    expect(eur.data?.usdPerUnit).toBeGreaterThan(1);
    expect(eur.data?.decimals).toBe(14);
    const cny = await a.reflector({ symbol: 'CNY' }, a.ctx.reflector);
    expect(cny.status).toBe('ok');
    expect(cny.data).toBeNull();
  });

  it('opensanctions answers no-match from the fallback when there is no fixture', async () => {
    const r = await a.opensanctions({ queries: [{ id: 'supplier', schema: 'Company', name: 'Nobody Trading Co' }] }, a.ctx.opensanctions);
    expect(r.status).toBe('ok');
    expect(r.mode).toBe('mock');
    expect(r.data?.[0]?.score).toBe(0);
  });

  it('shipsgo mock without a fixture yields an empty tracking snapshot', async () => {
    const r = await a.shipsgo.getTracking({ requestId: 'x', containers: ['ZZZU0000000'] }, a.ctx.shipsgo);
    expect(r.status).toBe('ok');
    expect(r.data?.events).toEqual([]);
    expect(r.data?.statusCode).toBeNull();
  });

  it('llm mock without a fixture fails loudly with the fixture name', async () => {
    const r = await a.llm.structured({ stage: 't', tier: 'fast', promptVersion: '1', system: 's', user: [{ text: 'u' }], schema: z.object({ a: z.string() }), toolName: 't', toolDescription: 'd' }, a.ctx.llm);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no fixture llm\//);
  });

  it('resend is log-only without a key', async () => {
    const r = await a.resend({ to: 'x@example.com', subject: 's', text: 't', idempotencyKey: 'k1' }, a.ctx.resend);
    expect(r.status).toBe('ok');
    expect(r.mode).toBe('mock');
    expect(r.data?.id).toMatch(/^log-only/);
  });
});

describe('adapter base', () => {
  it('caches live responses for 24 h and marks them cached', async () => {
    let calls = 0;
    const ad = defineAdapter<{ q: string }, { v: number }, number>({ name: 'test', keyOf: (i) => i, live: async () => ({ v: ++calls }), schema: z.object({ v: z.number() }), map: (r) => r.v });
    const ctx = adapterContext({ mode: 'live', cache: new MemoryCache(), record: false });
    expect((await ad({ q: 'a' }, ctx)).data).toBe(1);
    const second = await ad({ q: 'a' }, ctx);
    expect(second.data).toBe(1);
    expect(second.cached).toBe(true);
    expect((await ad({ q: 'b' }, ctx)).data).toBe(2);
  });

  it('retries transient failures and reports unavailable after they persist', async () => {
    let calls = 0;
    const ad = defineAdapter<{ q: string }, { v: number }, number>({
      name: 'flaky',
      keyOf: (i) => i,
      live: async () => {
        calls++;
        throw new Error('ECONNRESET');
      },
      schema: z.object({ v: z.number() }),
      map: (r) => r.v,
      timeoutMs: 500,
    });
    const r = await ad({ q: 'a' }, adapterContext({ mode: 'live', cache: null, record: false }));
    expect(r.status).toBe('unavailable');
    expect(calls).toBe(3);
  });

  it('rejects responses that fail the schema', async () => {
    const ad = defineAdapter<{ q: string }, { v: number }, number>({ name: 'bad', keyOf: (i) => i, live: async () => ({ v: 'no' }), schema: z.object({ v: z.number() }), map: (r) => r.v });
    const r = await ad({ q: 'a' }, adapterContext({ mode: 'live', cache: null, record: false }));
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/validation/);
  });
});

describe('shipsgo mapping', () => {
  it('derives the loading event, transshipments and status from a v1.2 record', () => {
    const t = mapShipsgo(
      [
        {
          StatusId: 40,
          Status: 'Sailing',
          ContainerNumber: 'CSQU3054383',
          Pol: 'SHANGHAI',
          Pod: 'LAGOS APAPA',
          Vessel: 'MAERSK KENTUCKY',
          VesselIMO: '9192456',
          VesselVoyage: '412E',
          LoadingDate: { Date: '2026-10-02', IsActual: true },
          DepartureDate: { Date: '2026-10-03', IsActual: true },
          ArrivalDate: { Date: '2026-11-08', IsActual: false },
          TSPorts: [{ Port: 'TANGER MED', ArrivalDate: { Date: '2026-10-25', IsActual: false }, DepartureDate: { Date: '2026-10-27', IsActual: false }, Vessel: 'MSC AURORA', VesselIMO: '9876543' }],
        },
      ],
      'mock',
      ['CSQU3054383'],
    );
    expect(t.loadingEvent?.vessel).toBe('MAERSK KENTUCKY');
    expect(t.loadingEvent?.port).toBe('SHANGHAI');
    expect(t.transshipments[0]?.vessel).toBe('MSC AURORA');
    expect(t.statusCode).toBe(40);
    expect(t.events.length).toBe(5);
  });
});

describe('qcc helpers', () => {
  it('builds ApiKey, Timespan and an upper-case MD5 token', () => {
    const h = qccHeaders({ apiKey: 'k', secretKey: 's', baseUrl: '', ekybPath: '' }, 1700000000);
    expect(h['ApiKey']).toBe('k');
    expect(h['Timespan']).toBe('1700000000');
    expect(h['Token']).toMatch(/^[0-9A-F]{32}$/);
  });
  it('normalises Chinese status words', () => {
    expect(normaliseQccStatus('存续（在营、开业、在册）')).toBe('ACTIVE');
    expect(normaliseQccStatus('注销')).toBe('INACTIVE');
  });
});

describe('llm tool schema', () => {
  it('derives a JSON schema without $schema from zod', () => {
    const js = toolInputSchema(z.object({ a: z.string().nullable(), b: z.enum(['x', 'y']) }));
    expect(js['$schema']).toBeUndefined();
    expect(js['type']).toBe('object');
  });
});

describe('fillDefaults', () => {
  it('fills omitted nested field objects and arrays from the JSON schema without touching present values', () => {
    const schema = toolInputSchema(z.object({ type: z.literal('invoice'), buyer: z.object({ name_en: z.object({ value: z.string().nullable(), evidence: z.string().nullable(), page: z.number().int().positive().nullable(), confidence: z.number().min(0).max(1) }), name_zh: z.object({ value: z.string().nullable(), evidence: z.string().nullable(), page: z.number().int().positive().nullable(), confidence: z.number().min(0).max(1) }) }), items: z.array(z.object({ q: z.number() })), hidden: z.array(z.string()) }));
    const out = fillDefaults(schema, { buyer: { name_en: { value: 'X', evidence: 'X', page: 1, confidence: 0.9 } } }) as Record<string, unknown>;
    expect(out['type']).toBe('invoice');
    expect((out['buyer'] as Record<string, unknown>)['name_zh']).toEqual({ value: null, evidence: null, page: null, confidence: 0 });
    expect((out['buyer'] as Record<string, Record<string, unknown>>)['name_en']!['value']).toBe('X');
    expect(out['items']).toEqual([]);
    expect(out['hidden']).toEqual([]);
  });
});
