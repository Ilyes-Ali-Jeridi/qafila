/**
 * Deploys qafila_deals to testnet (PLAN 3.4, FLOWS 8 deployment notes).
 *
 *   pnpm deploy:testnet [--instance main|e2e] [--skip-build] [--skip-bindings] [--agent key|smart]
 *
 * 1. issues qUSD if SETTLEMENT_TOKEN_ID is empty and tops up the faucet and co-invest stock
 * 2. builds and uploads the wasm, deploys with the testnet config
 * 3. set_agent (the agent signer G key by default; `--agent smart` uses AGENT_SMART_ACCOUNT_ID)
 * 4. approve_investor(co-invest account)
 * 5. writes deployments/testnet.json (or testnet-e2e.json), updates .env, regenerates bindings
 * Progress goes to stderr; no secret is ever printed.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Client, type Config } from '@qafila/contract-client';
import { Asset, Keypair, Operation, xdr } from '@stellar/stellar-sdk';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import {
  ONE,
  adminClient,
  approveInvestor,
  call,
  ensureTrustline,
  explorerContractUrl,
  explorerTxUrl,
  loadChainEnv,
  makeRpc,
  mintQusd,
  networkConfig,
  qusdBalance,
  qusdContext,
  queueFor,
  repoRoot,
  requireEnv,
  sorobanTx,
  writeDeployment,
  type DeploymentFile,
} from '@qafila/chain';
import { setEnvValues } from './lib/env-file.ts';

const { values } = parseArgs({
  options: {
    instance: { type: 'string', default: 'main' },
    'skip-build': { type: 'boolean', default: false },
    'skip-bindings': { type: 'boolean', default: false },
    agent: { type: 'string', default: 'key' },
  },
});
const instance = values.instance === 'e2e' ? 'e2e' : 'main';
const log = (msg: string) => console.error(`[deploy:${instance}] ${msg}`);

/** Testnet config (task sheet): short tenors and grace so the demo fits in minutes. */
export const TESTNET_CONFIG: Config = {
  max_markup_bps: 1500,
  max_deposit_bps: 3000,
  max_investors_per_deal: 100,
  min_tenor_secs: 60n,
  grace_secs: 60n,
  base_importer_limit: 20_000n * ONE,
  limit_step: 10_000n * ONE,
  min_security_bps: 2000,
  security_step_bps: 250,
  security_floor_bps: 1000,
  max_extension_secs: 600n,
};

async function ensureQusd(): Promise<{ id: string; code: string; issuer: string; txs: Record<string, string> }> {
  const env = loadChainEnv({ reload: true });
  const cfg = networkConfig(env);
  const txs: Record<string, string> = {};
  const issuer = Keypair.fromSecret(requireEnv(env, 'QUSD_ISSUER_SECRET'));
  const code = env.SETTLEMENT_TOKEN_CODE;
  const asset = new Asset(code, issuer.publicKey());
  let id = env.SETTLEMENT_TOKEN_ID;
  if (!id) {
    log(`issuing ${code} (SAC deploy from the issuer)`);
    const server = makeRpc(cfg);
    const q = queueFor(server, issuer);
    const r = await q.submit((account) =>
      sorobanTx(server, account, cfg.passphrase, Operation.createStellarAssetContract({ asset })),
    );
    txs.qusdSacDeploy = r.hash ?? '';
    id = asset.contractId(cfg.passphrase);
    setEnvValues({ SETTLEMENT_TOKEN_ID: id, SETTLEMENT_TOKEN_ISSUER: issuer.publicKey(), SETTLEMENT_TOKEN_CODE: code });
  }
  // Faucet and co-invest stock (PLAN 4.5, FLOWS 8 deployment).
  const ctx = qusdContext(loadChainEnv({ reload: true }));
  for (const [name, key, floor, top] of [
    ['faucet', 'FAUCET_SECRET', 1_000_000n, 10_000_000n],
    ['coinvest', 'COINVEST_SECRET', 100_000n, 1_000_000n],
  ] as const) {
    const kp = Keypair.fromSecret(requireEnv(env, key));
    const trust = await ensureTrustline(kp, asset, ctx);
    if (trust) txs[`${name}Trustline`] = trust.hash ?? '';
    const bal = await qusdBalance(kp.publicKey(), ctx);
    if (bal < floor * ONE) {
      const r = await mintQusd({ to: kp.publicKey(), amount: top * ONE - bal }, ctx);
      txs[`${name}Mint`] = r.hash ?? '';
      log(`minted ${code} to ${name}`);
    }
  }
  if (!id) throw new Error('settlement token id missing after issuance');
  return { id, code, issuer: issuer.publicKey(), txs };
}

/**
 * Uploads the code through the stellar CLI: on testnet the write and rent fee for a
 * 50 KB wasm is thousands of XLM, above the uint32 fee cap of a plain transaction,
 * and the CLI wraps it in a fee-bump transaction. The source secret travels in the
 * CLI's STELLAR_ACCOUNT environment variable, never on the command line. Returns the
 * upload transaction hash (empty when the code was already on-chain).
 */
function uploadWasm(wasm: Buffer, hash: string, admin: Keypair, network: string): string {
  const wasmPath = resolve(repoRoot(), 'contracts/target/wasm32v1-none/release/qafila_deals.wasm');
  log(`uploading wasm (${wasm.length} bytes) through the stellar CLI`);
  const out = execFileSync(
    'stellar',
    ['contract', 'upload', '--wasm', wasmPath, '--network', network, '--fee', '100000'],
    { cwd: '/', env: { ...process.env, STELLAR_ACCOUNT: admin.secret() }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const printed = out.trim().split('\n').pop() ?? '';
  if (printed.toLowerCase() !== hash) throw new Error(`uploaded hash ${printed} differs from local ${hash}`);
  // The CLI prints the hash but not the tx hash on this path; the deploy tx below is the audit trail.
  return '';
}

async function codeExists(server: ReturnType<typeof makeRpc>, hashHex: string): Promise<boolean> {
  const key = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(hashHex, 'hex') }));
  const res = await server.getLedgerEntries(key);
  return res.entries.length > 0;
}

function buildWasm(): { wasm: Buffer; hash: string } {
  const contracts = resolve(repoRoot(), 'contracts');
  if (!values['skip-build']) {
    log('stellar contract build --package qafila_deals');
    execFileSync('stellar', ['contract', 'build', '--package', 'qafila_deals'], { cwd: contracts, stdio: 'inherit' });
  }
  const wasm = readFileSync(resolve(contracts, 'target/wasm32v1-none/release/qafila_deals.wasm'));
  const hash = createHash('sha256').update(wasm).digest('hex');
  log(`wasm ${wasm.length} bytes, hash ${hash}`);
  return { wasm, hash };
}

async function main(): Promise<void> {
  const env = loadChainEnv();
  const cfg = networkConfig(env);
  if (cfg.network === 'mainnet') throw new Error('this script never touches mainnet');
  const server = makeRpc(cfg);
  const admin = Keypair.fromSecret(requireEnv(env, 'ADMIN_SECRET'));
  const verifier = Keypair.fromSecret(requireEnv(env, 'VERIFIER_ED25519_SECRET'));
  const agentSigner = Keypair.fromSecret(requireEnv(env, 'AGENT_SIGNER_SECRET'));
  const coinvest = Keypair.fromSecret(requireEnv(env, 'COINVEST_SECRET'));
  const charity = requireEnv(env, 'CHARITY_ADDRESS');
  const treasury = requireEnv(env, 'TREASURY_ADDRESS');
  const txs: Record<string, string> = {};

  const qusd = await ensureQusd();
  Object.assign(txs, qusd.txs);

  const { wasm, hash } = buildWasm();
  const adminQueue = queueFor(server, admin);
  if (await codeExists(server, hash)) {
    log(`wasm ${hash} already on-chain, skipping the upload`);
  } else {
    txs.uploadWasm = uploadWasm(wasm, hash, admin, cfg.network);
  }

  const agent = values.agent === 'smart' ? requireEnv(env, 'AGENT_SMART_ACCOUNT_ID') : agentSigner.publicKey();
  const signer = basicNodeSigner(admin, cfg.passphrase);
  log('deploying with constructor args');
  const deployTx = await Client.deploy(
    {
      admin: admin.publicKey(),
      verifier: Buffer.from(verifier.rawPublicKey()),
      charity,
      treasury,
      settlement: qusd.id,
      config: TESTNET_CONFIG,
    },
    {
      wasmHash: hash,
      format: 'hex',
      publicKey: admin.publicKey(),
      signTransaction: signer.signTransaction,
      signAuthEntry: signer.signAuthEntry,
      rpcUrl: cfg.rpcUrl,
      networkPassphrase: cfg.passphrase,
      allowHttp: cfg.rpcUrl.startsWith('http://'),
    },
  );
  const sent = await adminQueue.run(() => deployTx.signAndSend());
  const contractId = sent.result.options.contractId;
  txs.deploy = sent.sendTransactionResponse?.hash ?? '';
  log(`contract ${contractId} (${explorerContractUrl(cfg.network, contractId) ?? ''})`);

  const adminC = adminClient(env, contractId);
  const setAgent = await call(adminC, (c) => c.set_agent({ agent }));
  txs.setAgent = setAgent.hash ?? '';
  log(`set_agent ${agent}`);
  const approve = await approveInvestor(adminC, coinvest.publicKey());
  txs.approveCoinvest = approve.hash ?? '';
  log(`approve_investor ${coinvest.publicKey()} (co-invest)`);

  const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot(), encoding: 'utf8' }).trim();
  const file: DeploymentFile = {
    network: cfg.network,
    instance,
    contractId,
    wasmHash: hash,
    verifierPublicKeyHex: Buffer.from(verifier.rawPublicKey()).toString('hex'),
    verifierPublicKey: verifier.publicKey(),
    admin: admin.publicKey(),
    agent,
    agentSmartAccountId: env.AGENT_SMART_ACCOUNT_ID,
    charity,
    treasury,
    settlementToken: { id: qusd.id, code: qusd.code, issuer: qusd.issuer },
    coinvest: coinvest.publicKey(),
    probeContractId: env.PROBE_CONTRACT_ID,
    gitCommit,
    deployedAt: new Date().toISOString(),
    config: {
      max_markup_bps: TESTNET_CONFIG.max_markup_bps,
      max_deposit_bps: TESTNET_CONFIG.max_deposit_bps,
      max_investors_per_deal: TESTNET_CONFIG.max_investors_per_deal,
      min_tenor_secs: Number(TESTNET_CONFIG.min_tenor_secs),
      grace_secs: Number(TESTNET_CONFIG.grace_secs),
      base_importer_limit: TESTNET_CONFIG.base_importer_limit.toString(),
      limit_step: TESTNET_CONFIG.limit_step.toString(),
      min_security_bps: TESTNET_CONFIG.min_security_bps,
      security_step_bps: TESTNET_CONFIG.security_step_bps,
      security_floor_bps: TESTNET_CONFIG.security_floor_bps,
      max_extension_secs: Number(TESTNET_CONFIG.max_extension_secs),
    },
    txs,
  };
  const path = writeDeployment(file);
  log(`wrote ${path}`);
  setEnvValues(instance === 'main' ? { QAFILA_CONTRACT_ID: contractId } : { QAFILA_E2E_CONTRACT_ID: contractId });

  if (!values['skip-bindings']) {
    log('regenerating bindings');
    execFileSync('pnpm', ['bindings'], { cwd: repoRoot(), stdio: 'inherit' });
  }
  console.log(
    JSON.stringify(
      {
        instance,
        contractId,
        wasmHash: hash,
        agent,
        settlementToken: file.settlementToken,
        explorer: explorerContractUrl(cfg.network, contractId),
        deployTx: explorerTxUrl(cfg.network, txs.deploy ?? ''),
        file: path,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(`[deploy] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
