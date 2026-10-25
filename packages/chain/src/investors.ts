/** approve_investor / revoke_investor / is_investor_approved helpers (PLAN 4.4). */
import type { Client } from '@qafila/contract-client';
import type { Result } from '@stellar/stellar-sdk/contract';
import { call, view, type InvokeOutcome, type SignedClient } from './contract.ts';

export type VoidOutcome = InvokeOutcome<Result<void>>;

export function approveInvestor(admin: SignedClient, investor: string): Promise<VoidOutcome> {
  return call(admin, (c) => c.approve_investor({ investor }));
}

export function revokeInvestor(admin: SignedClient, investor: string): Promise<VoidOutcome> {
  return call(admin, (c) => c.revoke_investor({ investor }));
}

export async function isInvestorApproved(read: Client, investor: string): Promise<boolean> {
  return view(await read.is_investor_approved({ investor }));
}

/** Idempotent approve: skips the transaction when already approved. */
export async function ensureInvestorApproved(admin: SignedClient, investor: string): Promise<VoidOutcome | null> {
  if (await isInvestorApproved(admin.client, investor)) return null;
  return approveInvestor(admin, investor);
}
