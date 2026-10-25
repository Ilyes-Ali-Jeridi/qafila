/**
 * Reflector FX feed (PLAN 5.4, 10.4): `lastprice(Asset::Other(symbol))` simulated on the
 * testnet FX contract CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W, 14 decimals,
 * base USD. SP9 (Sun 25 Oct 14:45 WET): supported symbols are EUR, GBP, CHF, CAD, MXN,
 * ARS, BRL, THB, XAU; CNY, NGN and KES are NOT on the testnet feed, so the ECB fallback
 * covers CNY and local-currency amounts are hidden for NGN and KES.
 */
import { Account, Contract, TransactionBuilder, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { defineAdapter } from './base.js';

const LastPriceSchema = z.object({ price: z.string(), timestamp: z.string(), decimals: z.number().int() }).nullable();

export interface ReflectorPrice {
  symbol: string;
  /** 1 unit of `symbol` in USD. */
  usdPerUnit: number;
  decimals: number;
  timestamp: string;
  source: 'reflector';
}

const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

export async function simulateView(rpcUrl: string, passphrase: string, contractId: string, fn: string, args: xdr.ScVal[], signal?: AbortSignal): Promise<unknown> {
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const tx = new TransactionBuilder(new Account(DUMMY_SOURCE, '0'), { fee: '100', networkPassphrase: passphrase }).addOperation(new Contract(contractId).call(fn, ...args)).setTimeout(30).build();
  if (signal?.aborted) throw new Error('aborted');
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error.slice(0, 200)}`);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error('simulation returned no result');
  return scValToNative(sim.result.retval);
}

export const otherAsset = (symbol: string): xdr.ScVal => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Other'), xdr.ScVal.scvSymbol(symbol)]);

export function makeReflector(cfg: { rpcUrl: string; passphrase: string; feedId: string; decimals?: number }) {
  const decimals = cfg.decimals ?? 14;
  return defineAdapter<{ symbol: string }, z.infer<typeof LastPriceSchema>, ReflectorPrice | null>({
    name: 'reflector',
    keyOf: (i) => ({ feed: cfg.feedId, symbol: i.symbol.toUpperCase(), hour: new Date().toISOString().slice(0, 13) }),
    fixtureName: (i) => i.symbol.toUpperCase(),
    ttlMs: 60 * 60 * 1000,
    live: async (i, signal) => {
      const v = (await simulateView(cfg.rpcUrl, cfg.passphrase, cfg.feedId, 'lastprice', [otherAsset(i.symbol.toUpperCase())], signal)) as { price: bigint; timestamp: bigint } | null | undefined;
      if (v === null || v === undefined) return null;
      return { price: v.price.toString(), timestamp: v.timestamp.toString(), decimals };
    },
    schema: LastPriceSchema,
    map: (raw, i) => (raw ? { symbol: i.symbol.toUpperCase(), usdPerUnit: Number(raw.price) / 10 ** raw.decimals, decimals: raw.decimals, timestamp: new Date(Number(raw.timestamp) * 1000).toISOString(), source: 'reflector' } : null),
    mockFallback: () => null,
  });
}
