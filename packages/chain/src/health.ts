/** Zod-validated health reads for `pnpm doctor`: RPC health, latest ledger, Horizon root. */
import { z } from 'zod';
import type { NetworkConfig } from './env.ts';
import { makeRpc } from './rpc.ts';

export const RpcHealthSchema = z.object({
  status: z.string(),
  latestLedger: z.number().int().optional(),
  oldestLedger: z.number().int().optional(),
});
export type RpcHealth = z.infer<typeof RpcHealthSchema>;

export const LatestLedgerSchema = z.object({ sequence: z.number().int(), protocolVersion: z.number().int() });
export type LatestLedger = z.infer<typeof LatestLedgerSchema>;

export const HorizonRootSchema = z.object({
  horizon_version: z.string(),
  core_supported_protocol_version: z.number().int(),
  history_latest_ledger: z.number().int(),
  network_passphrase: z.string(),
});
export type HorizonRoot = z.infer<typeof HorizonRootSchema>;

export async function rpcHealth(cfg: NetworkConfig): Promise<RpcHealth> {
  return RpcHealthSchema.parse(await makeRpc(cfg).getHealth());
}

export async function rpcLatestLedger(cfg: NetworkConfig): Promise<LatestLedger> {
  return LatestLedgerSchema.parse(await makeRpc(cfg).getLatestLedger());
}

export async function horizonRoot(horizonUrl: string): Promise<HorizonRoot> {
  const res = await fetch(horizonUrl, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Horizon ${res.status}`);
  return HorizonRootSchema.parse(await res.json());
}
