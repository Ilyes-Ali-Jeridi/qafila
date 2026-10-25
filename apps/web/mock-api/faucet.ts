/**
 * Testnet faucet for the mock API. When FAUCET_SECRET and the qUSD SAC id are in .env it
 * really transfers test dollars on testnet (SAC `transfer` signed by the faucet key), so
 * passkey wallets created against the mock API can hold money for SP5 and the invest flow.
 * Without them it returns a fake hash labelled mode "mock".
 */
import { Contract, Keypair, TransactionBuilder, nativeToScVal, Address, BASE_FEE } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';
import { fakeTx } from './util.js';

export interface FaucetEnv {
  secret?: string;
  tokenId?: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export async function sendFaucet(env: FaucetEnv, to: string, amount: bigint, log: (m: string) => void): Promise<{ txHash: string; mode: 'live' | 'mock' }> {
  if (!env.secret || !env.tokenId) {
    log(`[mock] faucet: no FAUCET_SECRET or SETTLEMENT_TOKEN_ID, returning a fake hash for ${to}`);
    return { txHash: fakeTx(), mode: 'mock' };
  }
  const kp = Keypair.fromSecret(env.secret);
  const rpc = new Server(env.rpcUrl);
  const account = await rpc.getAccount(kp.publicKey());
  const token = new Contract(env.tokenId);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(
      token.call('transfer', new Address(kp.publicKey()).toScVal(), new Address(to).toScVal(), nativeToScVal(amount, { type: 'i128' })),
    )
    .setTimeout(60)
    .build();
  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await rpc.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`faucet send failed: ${JSON.stringify(sent.errorResult)}`);
  }
  const done = await rpc.pollTransaction(sent.hash, { attempts: 20 });
  if (done.status !== 'SUCCESS') {
    throw new Error(`faucet tx ${sent.hash} ended with ${done.status}`);
  }
  log(`[live] faucet sent ${amount} stroops of qUSD to ${to} in ${sent.hash}`);
  return { txHash: sent.hash, mode: 'live' };
}
