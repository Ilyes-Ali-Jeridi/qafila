/** Horizon reads with zod (accounts: balances, flags, signers). */
import { z } from 'zod';

export const HorizonBalanceSchema = z.object({
  asset_type: z.string(),
  asset_code: z.string().optional(),
  asset_issuer: z.string().optional(),
  balance: z.string(),
  limit: z.string().optional(),
  is_authorized: z.boolean().optional(),
  is_authorized_to_maintain_liabilities: z.boolean().optional(),
  is_clawback_enabled: z.boolean().optional(),
});

export const HorizonAccountSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  sequence: z.string(),
  home_domain: z.string().optional(),
  flags: z.object({
    auth_required: z.boolean(),
    auth_revocable: z.boolean(),
    auth_immutable: z.boolean(),
    auth_clawback_enabled: z.boolean(),
  }),
  thresholds: z.object({ low_threshold: z.number(), med_threshold: z.number(), high_threshold: z.number() }),
  signers: z.array(z.object({ key: z.string(), weight: z.number(), type: z.string() })),
  balances: z.array(HorizonBalanceSchema),
});
export type HorizonAccount = z.infer<typeof HorizonAccountSchema>;

export class HorizonNotFound extends Error {
  constructor(public readonly accountId: string) {
    super(`account not found on Horizon: ${accountId}`);
    this.name = 'HorizonNotFound';
  }
}

export async function fetchAccount(horizonUrl: string, accountId: string): Promise<HorizonAccount> {
  const res = await fetch(`${horizonUrl.replace(/\/$/, '')}/accounts/${accountId}`, { headers: { accept: 'application/json' } });
  if (res.status === 404) throw new HorizonNotFound(accountId);
  if (!res.ok) throw new Error(`Horizon ${res.status} for ${accountId}`);
  return HorizonAccountSchema.parse(await res.json());
}

export function findBalance(acc: HorizonAccount, code: string, issuer: string) {
  return acc.balances.find((b) => b.asset_code === code && b.asset_issuer === issuer);
}

export function hasTrustline(acc: HorizonAccount, code: string, issuer: string): boolean {
  return findBalance(acc, code, issuer) !== undefined;
}
