/**
 * Generated-client wiring for admin, agent and read-only use, plus a safe
 * `invoke` that signs, sends, waits and unwraps `Result<T>` into a typed error.
 */
import { Client, Errors } from '@qafila/contract-client';
import { Keypair } from '@stellar/stellar-sdk';
import { basicNodeSigner, type AssembledTransaction, type Result } from '@stellar/stellar-sdk/contract';
import { loadChainEnv, networkConfig, requireEnv, type ChainEnv, type NetworkConfig } from './env.ts';
import { makeRpc } from './rpc.ts';
import { queueFor, type SubmitQueue } from './queue.ts';

export class ContractError extends Error {
  constructor(
    public readonly code: number,
    public readonly label: string,
  ) {
    super(`contract error ${code} ${label}`);
    this.name = 'ContractError';
  }
}

const ERROR_LABELS: Record<number, string> = Object.fromEntries(
  Object.entries(Errors).map(([k, v]) => [Number(k), v.message]),
);

export function errorLabel(code: number): string {
  return ERROR_LABELS[code] ?? `Unknown(${code})`;
}

/** Turns the generated client's `Result<T>` (or a thrown simulation error) into `T` or a `ContractError`. */
export function unwrapResult<T>(r: Result<T>): T {
  if (r.isOk()) return r.unwrap();
  const err = r.unwrapErr();
  const m = /#(\d+)/.exec(err.message);
  const code = m ? Number(m[1]) : -1;
  throw new ContractError(code, errorLabel(code));
}

/** Maps a thrown error from `signAndSend`/simulation to `ContractError` when it carries `Error(Contract, #n)`. */
export function toContractError(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /Error\(Contract, #(\d+)\)/.exec(msg);
  if (m) {
    const code = Number(m[1]);
    return new ContractError(code, errorLabel(code));
  }
  return err;
}

export interface SignedClient {
  client: Client;
  keypair: Keypair;
  queue: SubmitQueue;
  cfg: NetworkConfig;
  contractId: string;
}

export interface MakeClientOptions {
  contractId: string;
  cfg: NetworkConfig;
  keypair: Keypair;
}

/** A generated `Client` that signs with `keypair` and submits through that key's queue. */
export function makeClient({ contractId, cfg, keypair }: MakeClientOptions): SignedClient {
  const signer = basicNodeSigner(keypair, cfg.passphrase);
  const client = new Client({
    contractId,
    networkPassphrase: cfg.passphrase,
    rpcUrl: cfg.rpcUrl,
    allowHttp: cfg.rpcUrl.startsWith('http://'),
    publicKey: keypair.publicKey(),
    signTransaction: signer.signTransaction,
    signAuthEntry: signer.signAuthEntry,
    errorTypes: Errors,
  });
  const queue = queueFor(makeRpc(cfg), keypair);
  return { client, keypair, queue, cfg, contractId };
}

/** A simulate-only client for views. */
export function readOnlyClient(contractId: string, cfg: NetworkConfig): Client {
  return new Client({
    contractId,
    networkPassphrase: cfg.passphrase,
    rpcUrl: cfg.rpcUrl,
    allowHttp: cfg.rpcUrl.startsWith('http://'),
    errorTypes: Errors,
  });
}

/** `Result<T>` from the generated client collapses to `T`; plain values stay as they are. */
export type Unwrapped<T> = T extends Result<infer U> ? U : T;

export interface InvokeOutcome<T> {
  result: Unwrapped<T>;
  hash: string | undefined;
}

/**
 * Signs and sends an already simulated `AssembledTransaction`, waits for finality and
 * returns the parsed result. `Result<T>` values are unwrapped into `T` or `ContractError`.
 * Pass `signed.queue` so calls from the same key never race on the sequence number.
 */
export async function invoke<T>(tx: AssembledTransaction<T>, queue?: SubmitQueue): Promise<InvokeOutcome<T>> {
  const send = async (): Promise<InvokeOutcome<T>> => {
    try {
      const sent = await tx.signAndSend();
      const raw: unknown = sent.result;
      const result = (isRustResult(raw) ? unwrapResult(raw) : raw) as Unwrapped<T>;
      return { result, hash: sent.sendTransactionResponse?.hash };
    } catch (err) {
      throw toContractError(err);
    }
  };
  return queue ? queue.run(send) : send();
}

/** Serialises "build then send" so the simulation also happens inside the queue. */
export async function call<T>(
  signed: SignedClient,
  build: (c: Client) => Promise<AssembledTransaction<T>>,
): Promise<InvokeOutcome<T>> {
  return signed.queue.run(async () => {
    const tx = await build(signed.client);
    try {
      const sent = await tx.signAndSend();
      const raw: unknown = sent.result;
      const result = (isRustResult(raw) ? unwrapResult(raw) : raw) as Unwrapped<T>;
      return { result, hash: sent.sendTransactionResponse?.hash };
    } catch (err) {
      throw toContractError(err);
    }
  });
}

/** Read a view: simulate and unwrap. */
export async function view<T>(tx: AssembledTransaction<T>): Promise<Unwrapped<T>> {
  try {
    const raw: unknown = tx.result;
    return (isRustResult(raw) ? unwrapResult(raw) : raw) as Unwrapped<T>;
  } catch (err) {
    throw toContractError(err);
  }
}

function isRustResult(v: unknown): v is Result<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    'isOk' in v &&
    typeof (v as { isOk: unknown }).isOk === 'function' &&
    'unwrap' in v &&
    typeof (v as { unwrap: unknown }).unwrap === 'function'
  );
}

export function contractIdFrom(env: ChainEnv, override?: string): string {
  return override ?? requireEnv(env, 'QAFILA_CONTRACT_ID');
}

/** Admin client from `.env` (ADMIN_SECRET). */
export function adminClient(env: ChainEnv = loadChainEnv(), contractId?: string): SignedClient {
  return makeClient({
    contractId: contractIdFrom(env, contractId),
    cfg: networkConfig(env),
    keypair: Keypair.fromSecret(requireEnv(env, 'ADMIN_SECRET')),
  });
}

/**
 * Agent client from `.env` (AGENT_SIGNER_SECRET), signing as a plain G account.
 * When AGENT_SMART_ACCOUNT_ID is set, the agent role on-chain is the smart account;
 * calls as that account are built the same way but must be authorized by the smart
 * account's signer and submitted through the relayer (services/api), not here.
 */
export function agentClient(env: ChainEnv = loadChainEnv(), contractId?: string): SignedClient & { smartAccountId?: string } {
  const signed = makeClient({
    contractId: contractIdFrom(env, contractId),
    cfg: networkConfig(env),
    keypair: Keypair.fromSecret(requireEnv(env, 'AGENT_SIGNER_SECRET')),
  });
  return env.AGENT_SMART_ACCOUNT_ID ? { ...signed, smartAccountId: env.AGENT_SMART_ACCOUNT_ID } : signed;
}

/** Signing client for any secret from `.env` (faucet, coinvest, demo importer...). */
export function clientFor(secret: string, env: ChainEnv = loadChainEnv(), contractId?: string): SignedClient {
  return makeClient({ contractId: contractIdFrom(env, contractId), cfg: networkConfig(env), keypair: Keypair.fromSecret(secret) });
}

export function viewClient(env: ChainEnv = loadChainEnv(), contractId?: string): Client {
  return readOnlyClient(contractIdFrom(env, contractId), networkConfig(env));
}
