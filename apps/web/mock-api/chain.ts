/**
 * Optional real-chain pieces for the mock API, used when .env has the keys and Track A's
 * deployment exists. They make the mock a faithful stand-in until Track B's API is ready:
 * - approve_investor from the admin key (so a passkey wallet can really invest on testnet)
 * - get_deal overlay from the deployed contract for deals aligned with the testnet seed
 */
import { Keypair } from '@stellar/stellar-sdk';
import { Client } from '@qafila/contract-client';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import { readJson, ROOT, SHARED } from './util.js';

export interface SeedDeal {
  name: string;
  dealId: string;
  state: string;
  shareToken: string;
  shareIssuer: string;
  assetCode: string;
  cost: string;
  security: string;
  listingFingerprintHex: string;
  txs: Record<string, string>;
}
export interface Seed {
  contractId: string;
  importer: string;
  supplier: string;
  investors: Record<string, string>;
  deals: SeedDeal[];
  seededAt: string;
}

export function readSeed(): Seed | null {
  return readJson<Seed>(`${SHARED}/seed-testnet.json`) ?? readJson<Seed>(`${ROOT}/deployments/seed-testnet.json`);
}

export interface ChainEnv {
  contractId: string | null;
  rpcUrl: string;
  networkPassphrase: string;
  adminSecret?: string;
}

export function chainReader(env: ChainEnv): Client | null {
  if (!env.contractId) return null;
  return new Client({ contractId: env.contractId, rpcUrl: env.rpcUrl, networkPassphrase: env.networkPassphrase });
}

/** Real approve_investor signed by the admin key. Returns the tx hash or null when not configured. */
export async function approveInvestorOnchain(env: ChainEnv, investor: string, log: (m: string) => void): Promise<string | null> {
  if (!env.contractId || !env.adminSecret) return null;
  const kp = Keypair.fromSecret(env.adminSecret);
  const client = new Client({ contractId: env.contractId, rpcUrl: env.rpcUrl, networkPassphrase: env.networkPassphrase, publicKey: kp.publicKey(), ...basicNodeSigner(kp, env.networkPassphrase) });
  const already = await client.is_investor_approved({ investor }).then((t) => t.result).catch(() => false);
  if (already) {
    log(`[live] ${investor} already approved on-chain`);
    return null;
  }
  const tx = await client.approve_investor({ investor }, { timeoutInSeconds: 60 });
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash ?? sent.getTransactionResponse?.txHash ?? null;
  log(`[live] approve_investor(${investor}) -> ${hash}`);
  return hash;
}

export interface OnchainOverlay {
  state: string;
  funded: bigint;
  supplierPaid: bigint;
  salePrice: bigint;
  principalRepaid: bigint;
  dueAt: number;
  ownedAt: number;
  acceptedAt: number;
  lateFeeDue: bigint;
  lateFeePaid: bigint;
  recovered: bigint;
  distributable: bigint;
  claimedShares: bigint;
  paidOut: bigint;
  holderCount: number;
  security: bigint;
  listedAt: number;
}

const cache = new Map<number, { at: number; value: OnchainOverlay | null }>();

/** Live deal state from the contract, cached 5 s. Null when the contract or the deal is not there. */
export async function readDealOnchain(reader: Client, dealId: number): Promise<OnchainOverlay | null> {
  const c = cache.get(dealId);
  if (c && Date.now() - c.at < 5_000) return c.value;
  try {
    const tx = await reader.get_deal({ deal_id: BigInt(dealId) });
    const r = tx.result;
    const deal = r.isOk() ? r.unwrap() : null;
    const value: OnchainOverlay | null = deal
      ? {
          state: deal.state.tag,
          funded: deal.funded,
          supplierPaid: deal.supplier_paid,
          salePrice: deal.sale_price,
          principalRepaid: deal.principal_repaid,
          dueAt: Number(deal.due_at),
          ownedAt: Number(deal.owned_at),
          acceptedAt: Number(deal.accepted_at),
          lateFeeDue: deal.late_fee_due,
          lateFeePaid: deal.late_fee_paid,
          recovered: deal.recovered,
          distributable: deal.distributable,
          claimedShares: deal.claimed_shares,
          paidOut: deal.paid_out,
          holderCount: deal.holder_count,
          security: deal.security,
          listedAt: Number(deal.listed_at),
        }
      : null;
    cache.set(dealId, { at: Date.now(), value });
    return value;
  } catch {
    cache.set(dealId, { at: Date.now(), value: null });
    return null;
  }
}
