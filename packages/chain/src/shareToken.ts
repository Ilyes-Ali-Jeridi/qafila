/**
 * Share-token factory (PLAN 3.1, steps 1 to 8).
 *
 * 1. issuer keypair in memory          2. funder creates it with 2 XLM
 * 3. flags + home domain               4. deploy the SAC
 * 5. issuer: SAC set_admin(contract)   6. master weight 0, secret discarded
 * 7. verify from Horizon               8. return the SAC id for DealTerms.share_token
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Address,
  Asset,
  AuthClawbackEnabledFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  type Account,
  type Transaction,
} from '@stellar/stellar-sdk';
import { z } from 'zod';
import { loadChainEnv, networkConfig, requireEnv, type ChainEnv, type NetworkConfig } from './env.ts';
import { fetchAccount, type HorizonAccount } from './horizon.ts';
import { makeRpc, type RpcServer } from './rpc.ts';
import { queueFor, SubmitQueue } from './queue.ts';
import { sorobanTx } from './qusd.ts';

const execFileP = promisify(execFile);

/** `QF` + zero-padded deal number, 10 characters (classic codes allow 1 to 12). */
export function shareAssetCode(dealNumber: number | bigint): string {
  const n = BigInt(dealNumber);
  if (n < 1n || n > 99_999_999n) throw new Error('deal number must be 1..99999999');
  return `QF${n.toString().padStart(8, '0')}`;
}

export const ShareTokenResultSchema = z.object({
  assetCode: z.string().regex(/^QF\d{8}$/),
  issuer: z.string().regex(/^G[A-Z2-7]{55}$/),
  sacId: z.string().regex(/^C[A-Z2-7]{55}$/),
  admin: z.string().regex(/^C[A-Z2-7]{55}$/),
  homeDomain: z.string(),
  txs: z.object({
    createIssuer: z.string(),
    setFlags: z.string(),
    deploySac: z.string(),
    setAdmin: z.string(),
    lockIssuer: z.string(),
  }),
  verified: z.object({
    authRequired: z.literal(true),
    authRevocable: z.literal(true),
    authClawbackEnabled: z.literal(true),
    masterWeight: z.literal(0),
    signerCount: z.literal(1),
  }),
});
export type ShareTokenResult = z.infer<typeof ShareTokenResultSchema>;

export interface CreateShareTokenOptions {
  dealNumber: number | bigint;
  /** The contract that becomes the SAC admin (the Qafila contract; a spike may pass another). */
  adminContractId: string;
  env?: ChainEnv;
  cfg?: NetworkConfig;
  rpc?: RpcServer;
  funder?: Keypair;
  homeDomain?: string;
  /** Called after each step, for progress output. Never receives secrets. */
  onStep?: (step: string, detail: string) => void;
}

function classic(account: Account, passphrase: string, ops: ReturnType<typeof Operation.setOptions>[]): Transaction {
  const b = new TransactionBuilder(account, { fee: (Number(BASE_FEE) * 10).toString(), networkPassphrase: passphrase });
  for (const op of ops) b.addOperation(op);
  return b.setTimeout(60).build();
}

/** Horizon verification of PLAN 3.1 step 7. Throws with the exact failed check. */
export function verifyIssuerLocked(acc: HorizonAccount, homeDomain: string): ShareTokenResult['verified'] {
  if (!acc.flags.auth_required) throw new Error('issuer: AUTH_REQUIRED not set');
  if (!acc.flags.auth_revocable) throw new Error('issuer: AUTH_REVOCABLE not set');
  if (!acc.flags.auth_clawback_enabled) throw new Error('issuer: AUTH_CLAWBACK_ENABLED not set');
  const master = acc.signers.find((s) => s.key === acc.account_id);
  if (!master || master.weight !== 0) throw new Error('issuer: master weight is not 0');
  if (acc.signers.length !== 1) throw new Error(`issuer: expected 1 signer, found ${acc.signers.length}`);
  if (acc.home_domain !== homeDomain) throw new Error(`issuer: home domain is ${acc.home_domain ?? 'unset'}`);
  return { authRequired: true, authRevocable: true, authClawbackEnabled: true, masterWeight: 0, signerCount: 1 };
}

/**
 * Deploying a SAC needs no signature from the issuer (anyone may wrap an asset), so the
 * funder is the source and pays the resource fee; a 2 XLM issuer cannot (txINSUFFICIENT_BALANCE).
 */
async function deploySac(
  server: RpcServer,
  funder: Keypair,
  funderQueue: SubmitQueue,
  asset: Asset,
  cfg: NetworkConfig,
): Promise<string> {
  try {
    const r = await funderQueue.submit((account) =>
      sorobanTx(server, account, cfg.passphrase, Operation.createStellarAssetContract({ asset })),
    );
    return r.hash;
  } catch (err) {
    // Fallback: the CLI does the same thing. The funder secret goes through STELLAR_ACCOUNT, never argv.
    const msg = err instanceof Error ? err.message : String(err);
    const issuerId = asset.getIssuer();
    const { stdout, stderr } = await execFileP(
      'stellar',
      ['contract', 'asset', 'deploy', '--asset', `${asset.getCode()}:${issuerId ?? ''}`, '--rpc-url', cfg.rpcUrl, '--network-passphrase', cfg.passphrase],
      { env: { ...process.env, STELLAR_ACCOUNT: funder.secret() }, timeout: 120_000 },
    ).catch((e: unknown) => {
      throw new Error(`SAC deploy failed in SDK (${msg}) and CLI (${e instanceof Error ? e.message : String(e)})`);
    });
    const m = /tx\/([0-9a-f]{64})/.exec(`${stdout}\n${stderr}`);
    return m?.[1] ?? 'cli';
  }
}

/** Runs the whole factory. The issuer secret exists only inside this call. */
export async function createShareToken(opts: CreateShareTokenOptions): Promise<ShareTokenResult> {
  const env = opts.env ?? loadChainEnv();
  const cfg = opts.cfg ?? networkConfig(env);
  const server = opts.rpc ?? makeRpc(cfg);
  const funder = opts.funder ?? Keypair.fromSecret(requireEnv(env, 'SHARE_ISSUER_FUNDER_SECRET'));
  const homeDomain = opts.homeDomain ?? env.APP_DOMAIN;
  const admin = new Address(opts.adminContractId).toString();
  if (!admin.startsWith('C')) throw new Error('adminContractId must be a contract address');
  const step = opts.onStep ?? (() => undefined);

  const assetCode = shareAssetCode(opts.dealNumber);
  const issuer = Keypair.random(); // 1
  const asset = new Asset(assetCode, issuer.publicKey());
  const sacId = asset.contractId(cfg.passphrase);
  step('issuer', issuer.publicKey());

  const funderQueue = queueFor(server, funder);
  const createIssuer = await funderQueue.submit((account) => // 2
    classic(account, cfg.passphrase, [Operation.createAccount({ destination: issuer.publicKey(), startingBalance: '2' })]),
  );
  step('createIssuer', createIssuer.hash);

  const issuerQueue = new SubmitQueue({ rpc: server, keypair: issuer });
  const setFlags = await issuerQueue.submit((account) => // 3
    classic(account, cfg.passphrase, [
      Operation.setOptions({ setFlags: (AuthRequiredFlag | AuthRevocableFlag | AuthClawbackEnabledFlag) as 1 | 2 | 4, homeDomain }),
    ]),
  );
  step('setFlags', setFlags.hash);

  const deploySacHash = await deploySac(server, funder, funderQueue, asset, cfg); // 4
  step('deploySac', `${sacId} ${deploySacHash}`);

  const setAdmin = await issuerQueue.submit((account) => // 5
    sorobanTx(server, account, cfg.passphrase, new Contract(sacId).call('set_admin', new Address(admin).toScVal())),
  );
  step('setAdmin', setAdmin.hash);

  const lockIssuer = await issuerQueue.submit((account) => // 6
    classic(account, cfg.passphrase, [Operation.setOptions({ masterWeight: 0 })]),
  );
  step('lockIssuer', lockIssuer.hash);

  const acc = await fetchAccount(cfg.horizonUrl, issuer.publicKey()); // 7
  const verified = verifyIssuerLocked(acc, homeDomain);
  step('verified', 'flags set, master weight 0, one signer');

  return ShareTokenResultSchema.parse({ // 8
    assetCode,
    issuer: issuer.publicKey(),
    sacId,
    admin,
    homeDomain,
    txs: { createIssuer: createIssuer.hash, setFlags: setFlags.hash, deploySac: deploySacHash, setAdmin: setAdmin.hash, lockIssuer: lockIssuer.hash },
    verified,
  });
}

/** Re-check an existing share issuer from Horizon (used by the deal page "Issuer locked" badge and doctor). */
export async function checkShareIssuer(horizonUrl: string, issuer: string, homeDomain: string): Promise<ShareTokenResult['verified']> {
  return verifyIssuerLocked(await fetchAccount(horizonUrl, issuer), homeDomain);
}
