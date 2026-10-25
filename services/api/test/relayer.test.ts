/**
 * Review finding R-1: a relayer "self call" (an auth entry whose address equals the invoked
 * contract) was sponsored for any contract, because an auth entry is only data until the
 * contract calls require_auth. The relayer must sponsor a self call only when the invoked
 * contract runs an allowed smart-account wasm.
 */
import { describe, expect, it } from 'vitest';
import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { relayerApp, type RelayerRpc } from '../src/relayer.js';

const ALLOWED_WASM = 'a'.repeat(64);
const OTHER_WASM = 'b'.repeat(64);
const QAFILA = Address.contract(Buffer.alloc(32, 1)).toString();
const ATTACKER_CONTRACT = Address.contract(Buffer.alloc(32, 2)).toString();
const SMART_ACCOUNT = Address.contract(Buffer.alloc(32, 3)).toString();

function selfCallBody(contractId: string): { func: string; auth: string[] } {
  const addr = new Address(contractId).toScAddress();
  const inv = new xdr.InvokeContractArgs({ contractAddress: addr, functionName: 'execute', args: [] });
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(inv);
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({ address: addr, nonce: 0n, signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(inv), subInvocations: [] }),
  });
  return { func: func.toXDR('base64'), auth: [auth.toXDR('base64')] };
}

function instanceEntry(contractId: string, wasmHex: string): xdr.LedgerEntryData {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
      val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({ executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasmHex, 'hex')), storage: null })),
    }),
  );
}

/** Knows the wasm of two contracts; stops every sponsored call at getAccount so the test never reaches the network. */
const fakeRpc = {
  getLedgerEntries: async (key: xdr.LedgerKey) => {
    if (key.type !== 'contractData') return { latestLedger: 1, entries: [] };
    const id = Address.fromScAddress(key.contractData.contract).toString();
    const wasm = id === SMART_ACCOUNT ? ALLOWED_WASM : id === ATTACKER_CONTRACT ? OTHER_WASM : null;
    return { latestLedger: 1, entries: wasm ? [{ key, val: instanceEntry(id, wasm), lastModifiedLedgerSeq: 1 }] : [] };
  },
  getAccount: async () => {
    throw Object.assign(new Error('stopped before the network'), { errorCode: 'STOPPED' });
  },
} as unknown as RelayerRpc;

const app = relayerApp(
  { secret: Keypair.random().secret(), rpcUrl: 'http://127.0.0.1:1', networkPassphrase: 'Test SDF Network ; September 2015', allowedContracts: [QAFILA], allowedWasmHashes: [ALLOWED_WASM], maxResourceFeeStroops: 1n, inclusionFeeStroops: '100', perIpPerMinute: 100 },
  () => undefined,
  { rpc: fakeRpc },
);

async function post(body: unknown): Promise<{ status: number; errorCode?: string; error?: string }> {
  const res = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, ...((await res.json()) as { errorCode?: string; error?: string }) };
}

describe('relayer allowlist', () => {
  it('refuses a self call to a contract that is not a sponsored smart account', async () => {
    const r = await post(selfCallBody(ATTACKER_CONTRACT));
    expect(r.status).toBe(400);
    expect(r.errorCode).toBe('UNAUTHORIZED');
    expect(r.error).toMatch(/not a sponsored smart account/);
  });

  it('refuses a self call to a contract it cannot find on the ledger', async () => {
    const r = await post(selfCallBody(Address.contract(Buffer.alloc(32, 9)).toString()));
    expect(r.status).toBe(400);
    expect(r.errorCode).toBe('UNAUTHORIZED');
  });

  it('sponsors a self call to a contract running an allowed smart-account wasm', async () => {
    const r = await post(selfCallBody(SMART_ACCOUNT));
    // Past the allowlist: the fake RPC stops the call at getAccount.
    expect(r.errorCode).toBe('STOPPED');
  });

  it('still sponsors calls to the allowlisted Qafila contract without any auth entry', async () => {
    const inv = new xdr.InvokeContractArgs({ contractAddress: new Address(QAFILA).toScAddress(), functionName: 'invest', args: [] });
    const r = await post({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(inv).toXDR('base64'), auth: [] });
    expect(r.errorCode).toBe('STOPPED');
  });
});
