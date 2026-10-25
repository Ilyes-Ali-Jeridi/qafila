/**
 * SP6 (PLAN 3.2): an OpenZeppelin smart account with an ed25519 signer whose rule
 * allows calls only to one contract can call that contract and cannot transfer tokens.
 *
 * Server-side, no WebAuthn. Uses smart-account-kit 0.8.0 helpers for the auth digest and
 * AuthPayload encoding, and the raw Stellar SDK for deploy / simulate / submit.
 *
 * Rules on the deployed account:
 *   rule 0  Default                 signers = [External(ed25519Verifier, ADMIN pub)]   (ops administers the account)
 *   rule 1  CallContract(TARGET)    signers = [External(ed25519Verifier, AGENT pub)]   (the agent can only call TARGET)
 *
 * Run: NODE_OPTIONS=--dns-result-order=ipv4first npx tsx contracts/spikes/sp6/agent-account.mts [deploy|test] [smartAccountId]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Address, Contract, Keypair, Operation, TransactionBuilder, hash, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { Ed25519Signer, signerToScVal } from 'smart-account-kit';
// smart-account-kit 0.8.0 internals are written for @stellar/stellar-sdk 16 (accessor methods); the
// workspace runs SDK 17 (js-xdr 5, plain fields), so the auth-entry handling below is reimplemented here.
type AddrCreds = xdr.SorobanAddressCredentials;
function addressCreds(entry: xdr.SorobanAuthorizationEntry): AddrCreds {
  const c = entry.credentials as unknown as { type: string; address?: AddrCreds; addressV2?: AddrCreds };
  if (c.type === 'sorobanCredentialsAddress' && c.address) return c.address;
  if (c.type === 'sorobanCredentialsAddressV2' && c.addressV2) return c.addressV2;
  throw new Error(`unsupported credentials ${c.type}`);
}
function isSourceAccountCreds(entry: xdr.SorobanAuthorizationEntry): boolean {
  return (entry.credentials as unknown as { type: string }).type === 'sorobanCredentialsSourceAccount';
}
/**
 * sha256 of the HashIdPreimage = what the host hands to __check_auth as signature_payload.
 * CAP-71: ADDRESS_V2 credentials (what simulation returns on protocol 27+ for contract addresses)
 * bind the address into the preimage (ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS); legacy
 * ADDRESS credentials use ENVELOPE_TYPE_SOROBAN_AUTHORIZATION. Mirrors stellar-sdk 17 `authorizeEntry`.
 */
function signaturePayload(entry: xdr.SorobanAuthorizationEntry, expiration: number): Buffer {
  const c = addressCreds(entry);
  const kind = (entry.credentials as unknown as { type: string }).type;
  const networkId = hash(Buffer.from(PASSPHRASE));
  const pre =
    kind === 'sorobanCredentialsAddress'
      ? xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
          new xdr.HashIdPreimageSorobanAuthorization({ networkId, nonce: c.nonce, signatureExpirationLedger: expiration, invocation: entry.rootInvocation }),
        )
      : xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
          new xdr.HashIdPreimageSorobanAuthorizationWithAddress({ networkId, nonce: c.nonce, signatureExpirationLedger: expiration, invocation: entry.rootInvocation, address: c.address }),
        );
  return Buffer.from(hash(pre.toXDR()));
}
/** smart-account-kit 0.8.0 formula: auth_digest = sha256(signature_payload ++ scvVec(context_rule_ids).toXDR()). */
function authDigestKit(payload: Buffer, ruleIds: number[]): Buffer {
  const ids = xdr.ScVal.scvVec(ruleIds.map((id) => xdr.ScVal.scvU32(id))).toXDR();
  return Buffer.from(hash(Buffer.concat([payload, Buffer.from(ids)])));
}
/** OpenZeppelin main-branch formula: sha256(xdr(AuthDigestPreimage { account, signature_payload, context_rule_ids })). */
function authDigestOz(sa: string, payload: Buffer, ruleIds: number[]): Buffer {
  const pre = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('account'), val: Address.fromString(sa).toScVal() }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('context_rule_ids'), val: xdr.ScVal.scvVec(ruleIds.map((id) => xdr.ScVal.scvU32(id))) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signature_payload'), val: xdr.ScVal.scvBytes(payload) }),
  ]);
  return Buffer.from(hash(pre.toXDR()));
}
const DIGEST_FORMULA = (process.env['SP6_DIGEST'] ?? 'kit') as 'kit' | 'oz';

/** AuthPayload { context_rule_ids: Vec<u32>, signers: Map<Signer, Bytes> } as the smart account decodes it. */
function authPayloadScVal(contextRuleIds: number[], signer: Ed25519Signer, signature: Buffer): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('context_rule_ids'), val: xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signers'), val: xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: signerToScVal(signer.signer), val: xdr.ScVal.scvBytes(signature) })]) }),
  ]);
}

const RPC_URL = process.env['STELLAR_RPC_URL'] ?? 'https://soroban-testnet.stellar.org';
const PASSPHRASE = process.env['NETWORK_PASSPHRASE'] ?? 'Test SDF Network ; September 2015';
// smart-account-kit protocol-27 testnet deployments (docs/deployments-protocol-27-2026-07-09.md, demo/.env.example), verified live on protocol 29
const envOr = (name: string, re: RegExp, dflt: string): string => {
  const v = process.env[name];
  return v && re.test(v) ? v : dflt;
};
const ACCOUNT_WASM_HASH = envOr('SMART_ACCOUNT_WASM_HASH', /^[0-9a-f]{64}$/i, '1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a');
const ED25519_VERIFIER = envOr('ED25519_VERIFIER_ADDRESS', /^C[A-Z2-7]{55}$/, 'CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4');
const QUSD = envOr('SETTLEMENT_TOKEN_ID', /^C[A-Z2-7]{55}$/, 'CB7WLKU45NHMLECCZGP5H6RH5IHMSHJXA7U4JSNM4MQT7WT46LZMC3KZ');
const TARGET = envOr('SP6_TARGET_CONTRACT_ID', /^C[A-Z2-7]{55}$/, readFileSync('/tmp/sp6_ping_id.txt', 'utf8').trim()); // sp6_ping on testnet

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
const relayer = Keypair.fromSecret(need('RELAYER_SECRET')); // fee payer and deployer
const faucet = Keypair.fromSecret(need('FAUCET_SECRET'));
const admin = Ed25519Signer.fromSecret(need('ADMIN_SECRET'), ED25519_VERIFIER);
const agent = Ed25519Signer.fromSecret(need('AGENT_SIGNER_SECRET'), ED25519_VERIFIER);

const server = new rpc.Server(RPC_URL);
const log = (...a: unknown[]) => console.log(...a);

async function pollTx(hash: string): Promise<rpc.Api.GetTransactionResponse> {
  for (let i = 0; i < 40; i++) {
    const r = await server.getTransaction(hash);
    if (r.status !== 'NOT_FOUND') return r;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error(`timeout waiting for ${hash}`);
}

/** Build, simulate, assemble, sign as `signer` (source account), send, wait. Returns the hash and result. */
async function submitOp(op: xdr.Operation, signer: Keypair, extraAuth?: xdr.SorobanAuthorizationEntry[]): Promise<{ hash: string; res: rpc.Api.GetSuccessfulTransactionResponse }> {
  const acct = await server.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(acct, { fee: '1000', networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(60).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);
  void extraAuth;
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(signer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status !== 'PENDING') throw new Error(`send failed: ${sent.status} ${JSON.stringify(sent.errorResult?.toXDR('base64'))}`);
  const res = await pollTx(sent.hash);
  if (res.status !== 'SUCCESS') throw new Error(`tx ${sent.hash} ${res.status}`);
  return { hash: sent.hash, res: res as rpc.Api.GetSuccessfulTransactionResponse };
}

function ed25519SignerScVal(s: Ed25519Signer): xdr.ScVal {
  return signerToScVal(s.signer);
}

// ---------------------------------------------------------------- deploy
async function deploy(): Promise<string> {
  log(`deploying smart account: wasm ${ACCOUNT_WASM_HASH.slice(0, 12)}…, deployer/fee payer ${relayer.publicKey()}`);
  const salt = Keypair.random().rawPublicKey(); // random 32-byte salt
  const op = Operation.createCustomContract({
    address: new Address(relayer.publicKey()),
    wasmHash: Buffer.from(ACCOUNT_WASM_HASH, 'hex'),
    salt: Buffer.from(salt),
    constructorArgs: [xdr.ScVal.scvVec([ed25519SignerScVal(admin)]), xdr.ScVal.scvMap([])],
  });
  const { hash, res } = await submitOp(op, relayer);
  const sa = Address.fromScVal(res.returnValue as xdr.ScVal).toString();
  log(`deployed smart account ${sa} tx ${hash}`);
  return sa;
}

// ------------------------------------------------- smart-account-signed call
/**
 * Simulate `hostFunc`, sign the smart account's auth entry with `signer` under `ruleId`
 * (one id per auth context), re-simulate with the signature, pay fees with the relayer, send.
 */
async function callAsSmartAccount(sa: string, hostFunc: xdr.HostFunction, signer: Ed25519Signer, ruleId: number, label: string): Promise<{ ok: boolean; hash?: string; error?: string }> {
  try {
    const acct = await server.getAccount(relayer.publicKey());
    const tx = new TransactionBuilder(acct, { fee: '1000', networkPassphrase: PASSPHRASE })
      .addOperation(Operation.invokeHostFunction({ func: hostFunc, auth: [] }))
      .setTimeout(60)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) return { ok: false, error: `pre-simulation: ${sim.error}` };
    const { sequence } = await server.getLatestLedger();
    const expiration = sequence + 100;
    const signed: xdr.SorobanAuthorizationEntry[] = [];
    for (const raw of sim.result?.auth ?? []) {
      const e = xdr.SorobanAuthorizationEntry.fromXDR(raw.toXDR());
      if (isSourceAccountCreds(e)) { signed.push(e); continue; }
      const creds = addressCreds(e);
      const who = Address.fromScAddress(creds.address).toString();
      if (who !== sa) return { ok: false, error: `unexpected auth entry for ${who}` };
      creds.signatureExpirationLedger = expiration;
      // one rule id per auth context in this entry (root + sub-invocations); every context uses `ruleId`
      const contexts = 1 + countSubInvocations(e.rootInvocation);
      const ruleIds = Array.from({ length: contexts }, () => ruleId);
      const payload = signaturePayload(e, expiration);
      const digest = DIGEST_FORMULA === 'oz' ? authDigestOz(sa, payload, ruleIds) : authDigestKit(payload, ruleIds);
      if (process.env['SP6_DEBUG']) log(`  creds=${(e.credentials as unknown as { type: string }).type} payload=${payload.toString('hex')} digest=${digest.toString('hex')} rules=${JSON.stringify(ruleIds)}`);
      creds.signature = authPayloadScVal(ruleIds, signer, signer.signAuthDigest(digest));
      signed.push(e);
    }
    // re-simulate with the signed auth entries, assemble, pay fees with the relayer, send
    const acct2 = await server.getAccount(relayer.publicKey());
    const tx2 = new TransactionBuilder(acct2, { fee: '1000', networkPassphrase: PASSPHRASE })
      .addOperation(Operation.invokeHostFunction({ func: hostFunc, auth: signed }))
      .setTimeout(60)
      .build();
    const sim2 = await server.simulateTransaction(tx2);
    if (rpc.Api.isSimulationError(sim2)) {
      const msg = sim2.error.replace(/\s+/g, ' ');
      log(`${label}: FAILED at re-simulation: ${msg.slice(0, 700)}`);
      return { ok: false, error: msg };
    }
    const prepared = rpc.assembleTransaction(tx2, sim2).build();
    prepared.sign(relayer);
    const sent = await server.sendTransaction(prepared);
    if (sent.status !== 'PENDING') return { ok: false, error: `send ${sent.status}: ${sent.errorResult?.toXDR('base64') ?? ''}` };
    const res = await pollTx(sent.hash);
    if (res.status !== 'SUCCESS') return { ok: false, hash: sent.hash, error: `tx ${res.status}` };
    log(`${label}: SUCCESS tx ${sent.hash}`);
    return { ok: true, hash: sent.hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`${label}: FAILED ${msg.slice(0, 600)}`);
    return { ok: false, error: msg };
  }
}

function countSubInvocations(inv: xdr.SorobanAuthorizedInvocation): number {
  let n = 0;
  for (const s of inv.subInvocations) n += 1 + countSubInvocations(s);
  return n;
}

function invoke(contractId: string, fn: string, ...args: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({ contractAddress: Address.fromString(contractId).toScAddress(), functionName: fn, args }),
  );
}

async function addAgentRule(sa: string): Promise<string | undefined> {
  const fn = invoke(
    sa,
    'add_context_rule',
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('CallContract'), Address.fromString(TARGET).toScVal()]), // context_type
    xdr.ScVal.scvString('qafila-agent'), // name (<= 20 bytes)
    xdr.ScVal.scvVoid(), // valid_until: None
    xdr.ScVal.scvVec([ed25519SignerScVal(agent)]), // signers
    xdr.ScVal.scvMap([]), // policies
  );
  const r = await callAsSmartAccount(sa, fn, admin, 0, 'add_context_rule(CallContract(TARGET), agent) signed by admin under rule 0');
  return r.hash;
}

async function fundWithQusd(sa: string, amount: bigint): Promise<string> {
  const op = new Contract(QUSD).call('transfer', Address.fromString(faucet.publicKey()).toScVal(), Address.fromString(sa).toScVal(), nativeToScVal(amount, { type: 'i128' }));
  const { hash } = await submitOp(op, faucet);
  log(`funded ${sa} with ${amount} stroops qUSD tx ${hash}`);
  return hash;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'deploy';
  const out: Record<string, unknown> = { target: TARGET, accountWasmHash: ACCOUNT_WASM_HASH, ed25519Verifier: ED25519_VERIFIER, adminSigner: admin.address, agentSigner: agent.address };
  let sa = process.argv[3] ?? process.env['AGENT_SMART_ACCOUNT_ID'] ?? '';
  if (mode === 'deploy' || !sa) {
    sa = await deploy();
    out['deployed'] = sa;
    out['addRuleTx'] = await addAgentRule(sa);
    out['fundTx'] = await fundWithQusd(sa, 100n * 10_000_000n);
  } else if (mode === 'rule') {
    out['addRuleTx'] = await addAgentRule(sa); // account already deployed and funded
  } else if (mode === 'rule-only') {
    // Production use: add `CallContract(TARGET)` for the agent signer and stop (no ping tests).
    out['addRuleTx'] = await addAgentRule(sa);
    out['smartAccountId'] = sa;
    console.log('RESULT ' + JSON.stringify(out, null, 2));
    return;
  }
  out['smartAccountId'] = sa;
  // Test A: agent calls TARGET.ping(caller = smart account) under rule 1
  const a = await callAsSmartAccount(sa, invoke(TARGET, 'ping', Address.fromString(sa).toScVal()), agent, 1, 'TEST A agent -> TARGET.ping');
  out['testA'] = a;
  // Test B1: agent tries qUSD.transfer(sa -> faucet, 1 qUSD) under rule 1 (CallContract(TARGET) does not match qUSD)
  const xfer = invoke(QUSD, 'transfer', Address.fromString(sa).toScVal(), Address.fromString(faucet.publicKey()).toScVal(), nativeToScVal(10_000_000n, { type: 'i128' }));
  out['testB_rule1'] = await callAsSmartAccount(sa, xfer, agent, 1, 'TEST B1 agent -> qUSD.transfer under rule 1');
  // Test B2: agent tries the same under rule 0 (Default rule requires the admin signer)
  out['testB_rule0'] = await callAsSmartAccount(sa, xfer, agent, 0, 'TEST B2 agent -> qUSD.transfer under rule 0');
  // Test C (control): the admin CAN transfer under rule 0 (the account is not broken, the policy is)
  out['testC_admin_transfer'] = await callAsSmartAccount(sa, xfer, admin, 0, 'TEST C admin -> qUSD.transfer under rule 0');
  // Test D (control): the agent cannot call TARGET under rule 0 either
  out['testD_agent_rule0_ping'] = await callAsSmartAccount(sa, invoke(TARGET, 'ping', Address.fromString(sa).toScVal()), agent, 0, 'TEST D agent -> TARGET.ping under rule 0');
  console.log('RESULT ' + JSON.stringify(out, null, 2));
}

main().catch((e: unknown) => {
  console.error('FATAL', e);
  process.exit(1);
});
