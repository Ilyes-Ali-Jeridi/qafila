// Copied from apps/web/mock-api/relayer.ts (Track C) so the API hosts the fee-sponsoring relayer at /relayer.
/**
 * Qafila fee-sponsoring relayer (testnet). Speaks the smart-account-kit relayer-proxy
 * protocol so the kit works unchanged:
 *
 *   POST /relayer  { func: base64 HostFunction, auth: [base64 SorobanAuthorizationEntry] }
 *   POST /relayer  { xdr: base64 signed transaction }   -> fee-bumped as is
 *   GET  /relayer  health
 *
 * Why not the kit's hosted proxy: OpenZeppelin Channels mints one key per client IP with a
 * 100 XLM daily budget and bids the network's p99 inclusion fee (60 XLM per call during the
 * hackathon), so one venue IP gets one or two calls a day (SP5, docs/SPIKES-product.md).
 * This relayer sources fees from RELAYER_SECRET with a modest inclusion fee and a resource
 * fee cap. Guards: one submit queue per key (PLAN 4.4), allowlisted targets, per-IP rate limit.
 * The integrator hosts it next to the API (same module, same env).
 */
import { Hono } from 'hono';
import { Address, Keypair, Operation, TransactionBuilder, xdr, type Transaction } from '@stellar/stellar-sdk';
import { Api, Server, assembleTransaction } from '@stellar/stellar-sdk/rpc';

export interface RelayerEnv {
  secret: string;
  rpcUrl: string;
  networkPassphrase: string;
  /** Contract ids any wallet may call through the relayer (Qafila, probe). Wallet self-calls are always allowed. */
  allowedContracts: string[];
  /** Account wasm hashes allowed for createContractV2 deployments. */
  allowedWasmHashes: string[];
  maxResourceFeeStroops: bigint;
  inclusionFeeStroops: string;
  perIpPerMinute: number;
}

type Body = { func?: string; auth?: string[]; xdr?: string };

/** The RPC surface the relayer uses; tests pass a fake. */
export type RelayerRpc = Pick<Server, 'getAccount' | 'simulateTransaction' | 'sendTransaction' | 'pollTransaction' | 'getLedgerEntries'>;

export function relayerApp(env: RelayerEnv, log: (m: string) => void, deps: { rpc?: RelayerRpc } = {}) {
  const app = new Hono();
  const kp = Keypair.fromSecret(env.secret);
  const rpc: RelayerRpc = deps.rpc ?? new Server(env.rpcUrl, { allowHttp: env.rpcUrl.startsWith('http://') });
  let queue: Promise<unknown> = Promise.resolve();
  const hits = new Map<string, number[]>();
  /** Contract id -> executable wasm hash (hex); a contract's code only changes by upgrade, so a short cache is safe. */
  const wasmCache = new Map<string, { hash: string | null; until: number }>();

  /** The wasm hash the contract instance runs, or null for a SAC or an unknown contract. */
  async function wasmHashOf(contractId: string): Promise<string | null> {
    const hit = wasmCache.get(contractId);
    if (hit && hit.until > Date.now()) return hit.hash;
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({ contract: new Address(contractId).toScAddress(), key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent }),
    );
    const res = await rpc.getLedgerEntries(key);
    let hash: string | null = null;
    const val = res.entries[0]?.val;
    if (val?.type === 'contractData' && val.contractData.val.type === 'scvContractInstance') {
      const exec = val.contractData.val.instance.executable;
      if (exec.type === 'contractExecutableWasm') hash = Buffer.from(exec.wasmHash.toXDR()).toString('hex');
    }
    wasmCache.set(contractId, { hash, until: Date.now() + 60_000 });
    return hash;
  }

  const fail = (status: 400 | 429 | 500, errorCode: string, error: string, details?: unknown) => Response.json({ success: false, error, errorCode, details }, { status });

  function rateLimited(ip: string): boolean {
    const now = Date.now();
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(ip, arr);
    return arr.length > env.perIpPerMinute;
  }

  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  }

  async function checkFunc(func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[]): Promise<string | null> {
    const kind = func.type;
    if (kind === 'hostFunctionTypeCreateContractV2' || kind === 'hostFunctionTypeCreateContract') {
      const args = kind === 'hostFunctionTypeCreateContractV2' ? func.createContractV2 : func.createContract;
      const exec = args.executable;
      if (exec.type !== 'contractExecutableWasm') return 'only wasm deployments are sponsored';
      const hash = Buffer.from(exec.wasmHash.toXDR()).toString('hex');
      if (!env.allowedWasmHashes.includes(hash)) return `wasm ${hash.slice(0, 8)} is not a sponsored smart account`;
      return null;
    }
    if (kind !== 'hostFunctionTypeInvokeContract') return 'unsupported host function';
    const inv = func.invokeContract;
    const targetStr = scAddressToString(inv.contractAddress);
    if (env.allowedContracts.includes(targetStr)) return null;
    // Smart-account self call (execute, add_signer, ...): an auth entry whose address is the invoked contract.
    // An auth entry is only data until the contract calls require_auth, so anyone can attach one that names
    // any contract; the invoked contract must therefore run a sponsored smart-account wasm (review finding R-1).
    const selfCall = auth.some((a) => a.credentials.type === 'sorobanCredentialsAddress' && scAddressToString(a.credentials.address.address) === targetStr);
    if (selfCall) {
      const hash = await wasmHashOf(targetStr).catch(() => null);
      if (hash && env.allowedWasmHashes.includes(hash)) return null;
      return `contract ${targetStr.slice(0, 8)}… is not a sponsored smart account`;
    }
    return `contract ${targetStr.slice(0, 8)}… is not sponsored`;
  }

  async function submitPrepared(tx: Transaction, label: string) {
    const sent = await rpc.sendTransaction(tx);
    if (sent.status === 'ERROR') {
      const reason = sent.errorResult?.toXDR('base64') ?? 'send failed';
      throw Object.assign(new Error(`send failed: ${reason}`), { errorCode: 'ONCHAIN_FAILED' });
    }
    const done = await rpc.pollTransaction(sent.hash, { attempts: 20 });
    if (done.status === 'SUCCESS') {
      log(`[relayer] ${label} ok ${sent.hash} ledger ${done.ledger}`);
      return { success: true, hash: sent.hash, status: 'SUCCESS', ledger: done.ledger };
    }
    if (done.status === 'FAILED') throw Object.assign(new Error(`failed on-chain: ${done.resultXdr?.toXDR('base64') ?? ''}`), { errorCode: 'ONCHAIN_FAILED', hash: sent.hash });
    return { success: true, hash: sent.hash, status: 'PENDING' };
  }

  app.get('/', async (c) => {
    try {
      const acct = await rpc.getAccount(kp.publicKey());
      return c.json({ ok: true, relayer: kp.publicKey(), sequence: acct.sequenceNumber(), network: env.networkPassphrase, allowedContracts: env.allowedContracts });
    } catch (e) {
      return c.json({ ok: false, relayer: kp.publicKey(), error: (e as Error).message }, 503);
    }
  });

  app.post('/', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('cf-connecting-ip') ?? 'local';
    if (rateLimited(ip)) return fail(429, 'POOL_CAPACITY', 'Too many requests from this address. Try again in a minute.');
    const body = (await c.req.json().catch(() => ({}))) as Body;
    try {
      if (typeof body.xdr === 'string') {
        const inner = TransactionBuilder.fromXDR(body.xdr, env.networkPassphrase);
        if (!('operations' in inner) || inner.operations.length !== 1) return fail(400, 'INVALID_XDR', 'Expected one operation.');
        const op = inner.operations[0];
        if (op?.type !== 'invokeHostFunction') return fail(400, 'INVALID_XDR', 'Expected an invokeHostFunction operation.');
        const reason = await checkFunc(op.func, op.auth ?? []);
        if (reason) return fail(400, 'UNAUTHORIZED', reason);
        const bump = TransactionBuilder.buildFeeBumpTransaction(kp, String(Number(env.inclusionFeeStroops) * 2), inner as Transaction, env.networkPassphrase);
        bump.sign(kp);
        const r = await serialized(() => submitPrepared(bump as unknown as Transaction, 'fee-bump'));
        return c.json(r);
      }
      if (typeof body.func !== 'string' || !Array.isArray(body.auth)) return fail(400, 'INVALID_PARAMS', 'Body must be { func, auth } or { xdr }.');
      if (body.auth.length > 8) return fail(400, 'INVALID_PARAMS', 'Too many auth entries.');
      const func = xdr.HostFunction.fromXDR(body.func, 'base64');
      const auth = body.auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64'));
      const reason = await checkFunc(func, auth);
      if (reason) return fail(400, 'UNAUTHORIZED', reason);
      const r = await serialized(async () => {
        const account = await rpc.getAccount(kp.publicKey());
        const tx = new TransactionBuilder(account, { fee: env.inclusionFeeStroops, networkPassphrase: env.networkPassphrase })
          .addOperation(Operation.invokeHostFunction({ func, auth }))
          .setTimeout(120)
          .build();
        const sim = await rpc.simulateTransaction(tx);
        if (Api.isSimulationError(sim)) throw Object.assign(new Error(sim.error), { errorCode: 'SIMULATION_FAILED' });
        if (Api.isSimulationRestore(sim)) throw Object.assign(new Error('contract state needs a restore before this call'), { errorCode: 'SIMULATION_FAILED' });
        const resourceFee = BigInt(sim.minResourceFee);
        if (resourceFee > env.maxResourceFeeStroops) throw Object.assign(new Error(`resource fee ${resourceFee} above the cap ${env.maxResourceFeeStroops}`), { errorCode: 'FEE_LIMIT_EXCEEDED' });
        const prepared = assembleTransaction(tx, sim).build();
        prepared.sign(kp);
        return submitPrepared(prepared, func.type === 'hostFunctionTypeInvokeContract' ? `invoke ${func.invokeContract.functionName.toString()}` : 'deploy');
      });
      return c.json(r);
    } catch (e) {
      const err = e as Error & { errorCode?: string; hash?: string };
      log(`[relayer] error ${err.errorCode ?? ''} ${err.message.slice(0, 300)}`);
      return fail(400, err.errorCode ?? 'ONCHAIN_FAILED', err.message, err.hash ? { hash: err.hash } : undefined);
    }
  });

  return app;
}

function scAddressToString(a: xdr.ScAddress): string {
  return Address.fromScAddress(a).toString();
}
