/**
 * qUSD ("test dollars") on testnet: issuer mints, trustlines, faucet sends.
 * Amounts are i128 stroops (7 decimals) as bigint. Every signing key submits
 * through its own SubmitQueue.
 */
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type Account,
  type Transaction,
} from '@stellar/stellar-sdk';
import { loadChainEnv, networkConfig, requireEnv, type ChainEnv, type NetworkConfig } from './env.ts';
import { fetchAccount, hasTrustline, HorizonNotFound } from './horizon.ts';
import { makeRpc, type RpcServer } from './rpc.ts';
import { queueFor, type SubmitResult } from './queue.ts';

export const DECIMALS = 7;
export const ONE = 10_000_000n;

/** bigint stroops to the decimal string classic operations take. */
export function stroopsToDecimal(stroops: bigint): string {
  if (stroops < 0n) throw new Error('negative amount');
  const whole = stroops / ONE;
  const frac = (stroops % ONE).toString().padStart(DECIMALS, '0');
  return `${whole}.${frac}`;
}

/** Decimal string ("2000", "2000.5") to bigint stroops. */
export function decimalToStroops(input: string): bigint {
  const m = /^\s*(\d+)(?:\.(\d{1,7}))?\s*$/.exec(input);
  if (!m) throw new Error(`invalid amount: ${input}`);
  return BigInt(m[1]!) * ONE + BigInt((m[2] ?? '').padEnd(DECIMALS, '0'));
}

export const isContractAddress = (addr: string): boolean => /^C[A-Z2-7]{55}$/.test(addr);
export const isAccountAddress = (addr: string): boolean => /^G[A-Z2-7]{55}$/.test(addr);

export interface QusdContext {
  env: ChainEnv;
  cfg: NetworkConfig;
  rpc: RpcServer;
  asset: Asset;
  sacId: string;
}

export function qusdContext(env: ChainEnv = loadChainEnv()): QusdContext {
  const cfg = networkConfig(env);
  const issuer = requireEnv(env, 'SETTLEMENT_TOKEN_ISSUER');
  const asset = new Asset(env.SETTLEMENT_TOKEN_CODE, issuer);
  const sacId = env.SETTLEMENT_TOKEN_ID ?? asset.contractId(cfg.passphrase);
  return { env, cfg, rpc: makeRpc(cfg), asset, sacId };
}

function classicTx(account: Account, passphrase: string, ops: ReturnType<typeof Operation.payment>[]): Transaction {
  const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: passphrase });
  for (const op of ops) b.addOperation(op);
  return b.setTimeout(60).build();
}

/** Simulates and assembles a one-operation Soroban tx from `account`. */
export async function sorobanTx(
  server: RpcServer,
  account: Account,
  passphrase: string,
  op: ReturnType<typeof Operation.invokeHostFunction>,
): Promise<Transaction> {
  const tx = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 100).toString(), networkPassphrase: passphrase })
    .addOperation(op)
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);
  return rpc.assembleTransaction(tx, sim).build();
}

/** Issuer sends `amount` of qUSD to `to`: classic payment for G, SAC `mint` for C (the SAC admin is the issuer). */
export async function mintQusd(
  { to, amount }: { to: string; amount: bigint },
  ctx: QusdContext = qusdContext(),
): Promise<SubmitResult> {
  if (amount <= 0n) throw new Error('amount must be positive');
  const issuer = Keypair.fromSecret(requireEnv(ctx.env, 'QUSD_ISSUER_SECRET'));
  const q = queueFor(ctx.rpc, issuer);
  if (isContractAddress(to)) {
    return q.submit((account) =>
      sorobanTx(
        ctx.rpc,
        account,
        ctx.cfg.passphrase,
        new Contract(ctx.sacId).call('mint', new Address(to).toScVal(), nativeToScVal(amount, { type: 'i128' })),
      ),
    );
  }
  if (!isAccountAddress(to)) throw new Error(`invalid destination: ${to}`);
  return q.submit((account) =>
    classicTx(account, ctx.cfg.passphrase, [
      Operation.payment({ destination: to, asset: ctx.asset, amount: stroopsToDecimal(amount) }),
    ]),
  );
}

/** Adds a trustline for `asset` to `keypair`'s account when missing. Returns the tx result or null when it already exists. */
export async function ensureTrustline(
  keypair: Keypair,
  asset: Asset,
  ctx: Pick<QusdContext, 'cfg' | 'rpc'> = qusdContext(),
): Promise<SubmitResult | null> {
  let exists = false;
  try {
    const acc = await fetchAccount(ctx.cfg.horizonUrl, keypair.publicKey());
    const issuer = asset.getIssuer();
    if (!issuer) throw new Error('native asset needs no trustline');
    exists = hasTrustline(acc, asset.getCode(), issuer);
  } catch (err) {
    if (!(err instanceof HorizonNotFound)) throw err;
    throw new Error(`account ${keypair.publicKey()} does not exist; fund it first`);
  }
  if (exists) return null;
  const q = queueFor(ctx.rpc, keypair);
  return q.submit((account) =>
    classicTx(account, ctx.cfg.passphrase, [Operation.changeTrust({ asset })]),
  );
}

/** Faucet sends `amount` qUSD to `to` (payment for G, SAC transfer for C). Caps and rate limits live in the API. */
export async function faucetSend(
  { to, amount }: { to: string; amount: bigint },
  ctx: QusdContext = qusdContext(),
): Promise<SubmitResult> {
  if (amount <= 0n) throw new Error('amount must be positive');
  const faucet = Keypair.fromSecret(requireEnv(ctx.env, 'FAUCET_SECRET'));
  const q = queueFor(ctx.rpc, faucet);
  if (isContractAddress(to)) {
    return q.submit((account) =>
      sorobanTx(
        ctx.rpc,
        account,
        ctx.cfg.passphrase,
        new Contract(ctx.sacId).call(
          'transfer',
          new Address(faucet.publicKey()).toScVal(),
          new Address(to).toScVal(),
          nativeToScVal(amount, { type: 'i128' }),
        ),
      ),
    );
  }
  if (!isAccountAddress(to)) throw new Error(`invalid destination: ${to}`);
  return q.submit((account) =>
    classicTx(account, ctx.cfg.passphrase, [
      Operation.payment({ destination: to, asset: ctx.asset, amount: stroopsToDecimal(amount) }),
    ]),
  );
}

/** qUSD balance of any address via the SAC `balance` view (simulation only; `source` is any funded G account). */
export async function qusdBalance(addr: string, ctx: QusdContext = qusdContext(), source?: string): Promise<bigint> {
  const sourceId = source ?? (isAccountAddress(addr) ? addr : requireEnv(ctx.env, 'CHARITY_ADDRESS'));
  const account = await ctx.rpc.getAccount(sourceId);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: ctx.cfg.passphrase })
    .addOperation(new Contract(ctx.sacId).call('balance', new Address(addr).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await ctx.rpc.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`balance simulation failed: ${sim.error}`);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error('balance simulation returned nothing');
  const native = scValToNative(sim.result.retval) as unknown;
  if (typeof native !== 'bigint') throw new Error('balance is not i128');
  return native;
}
