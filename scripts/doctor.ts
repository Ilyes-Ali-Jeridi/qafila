/**
 * pnpm doctor: pre-demo health check for the chain side (PLAN 12).
 *
 * Checks env completeness, RPC and Horizon, the deployment file, on-chain roles and
 * config, funding of the operational keys, trustlines of charity and treasury, the
 * agent smart account and echoes the feature flags. Exit code 1 on any FAIL.
 * Works before the contract is deployed (contract checks become WARN).
 */
import { Contract, Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  fetchAccount,
  findBalance,
  hasTrustline,
  HorizonNotFound,
  horizonRoot,
  loadChainEnv,
  makeRpc,
  networkConfig,
  readOnlyClient,
  rpcHealth,
  rpcLatestLedger,
  tryLoadDeployment,
  verifierKeyBytes,
  view,
  type ChainEnv,
  type NetworkConfig,
} from '@qafila/chain';

type Status = 'OK' | 'WARN' | 'FAIL';
interface Row {
  check: string;
  status: Status;
  detail: string;
  fix?: string;
}

const rows: Row[] = [];
const ok = (check: string, detail: string) => rows.push({ check, status: 'OK', detail });
const warn = (check: string, detail: string, fix?: string) => rows.push({ check, status: 'WARN', detail, fix });
const fail = (check: string, detail: string, fix: string) => rows.push({ check, status: 'FAIL', detail, fix });

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const REQUIRED_ENV = [
  'ADMIN_SECRET',
  'VERIFIER_ED25519_SECRET',
  'AGENT_SIGNER_SECRET',
  'SHARE_ISSUER_FUNDER_SECRET',
  'FAUCET_SECRET',
  'COINVEST_SECRET',
  'QUSD_ISSUER_SECRET',
  'CHARITY_ADDRESS',
  'TREASURY_ADDRESS',
  'SETTLEMENT_TOKEN_ID',
  'SETTLEMENT_TOKEN_CODE',
  'SETTLEMENT_TOKEN_ISSUER',
  'STELLAR_RPC_URL',
  'HORIZON_URL',
  'NETWORK_PASSPHRASE',
  'QAFILA_CONTRACT_ID',
] as const;

const FLAGS = [
  'FF_SUPPLIER_CONFIRM',
  'FF_EXTENSIONS',
  'FF_COINVEST',
  'FF_X402',
  'FF_TRUSTLESS_WORK',
  'FF_REFLECTOR',
  'FF_TRADE_PASSPORT',
  'FF_TRADE_FILE',
  'FF_QR_JOIN',
  'FF_USDT0_SWAP',
  'FF_ANCHOR',
  'FF_I18N',
  'FF_AIS',
];


const XLM_MIN = 20;
const QUSD_MIN = 1_000;

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function publicKeyOf(secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  try {
    return Keypair.fromSecret(secret).publicKey();
  } catch {
    return undefined;
  }
}

async function checkEnv(): Promise<ChainEnv | null> {
  // Load .env into process.env first (loadChainEnv does it, and tolerates missing optional keys).
  let loaded: ChainEnv | null = null;
  let loadError: string | undefined;
  try {
    loaded = loadChainEnv();
  } catch (e) {
    loadError = msg(e);
  }
  const missing = REQUIRED_ENV.filter((k) => !process.env[k] || process.env[k] === '');
  for (const k of missing) {
    if (k === 'QAFILA_CONTRACT_ID') warn('env QAFILA_CONTRACT_ID', 'not set', 'run pnpm deploy:testnet (writes deployments/testnet.json; copy the id into .env)');
    else fail(`env ${k}`, 'missing', `set ${k} in .env (see .env.example)`);
  }
  const present = REQUIRED_ENV.length - missing.length;
  if (missing.length === 0) ok('env present', `${present}/${REQUIRED_ENV.length} chain variables set`);
  else warn('env present', `${present}/${REQUIRED_ENV.length} chain variables set`);
  if (loadError !== undefined) {
    fail('env valid', loadError, 'fix the named variables in .env (format: S... secrets, G.../C... addresses, URLs)');
    return null;
  }
  return loaded;
}

async function checkRpc(cfg: NetworkConfig): Promise<boolean> {
  try {
    const health = await rpcHealth(cfg);
    const latest = await rpcLatestLedger(cfg);
    ok('rpc', `${cfg.rpcUrl} ${health.status}, ledger ${latest.sequence}, protocol ${latest.protocolVersion}`);
    return true;
  } catch (e) {
    fail('rpc', msg(e), `check STELLAR_RPC_URL (${cfg.rpcUrl}) and the network`);
    return false;
  }
}

async function checkHorizon(cfg: NetworkConfig): Promise<boolean> {
  try {
    const root = await horizonRoot(cfg.horizonUrl);
    if (root.network_passphrase !== cfg.passphrase) {
      fail('horizon passphrase', `Horizon says "${root.network_passphrase}"`, 'NETWORK_PASSPHRASE and HORIZON_URL point at different networks');
      return false;
    }
    ok('horizon', `${cfg.horizonUrl} v${root.horizon_version}, ledger ${root.history_latest_ledger}, core protocol ${root.core_supported_protocol_version}`);
    return true;
  } catch (e) {
    fail('horizon', msg(e), `check HORIZON_URL (${cfg.horizonUrl})`);
    return false;
  }
}

async function checkContract(env: ChainEnv, cfg: NetworkConfig): Promise<void> {
  let fileId: string | undefined;
  try {
    const dep = tryLoadDeployment('main', cfg.network === 'local' ? 'local' : 'testnet');
    if (!dep) {
      warn('deployments/testnet.json', 'missing: not deployed yet', 'run pnpm deploy:testnet');
    } else {
      fileId = dep.contractId;
      ok('deployments/testnet.json', `${short(dep.contractId)} deployed ${dep.deployedAt} at commit ${dep.gitCommit.slice(0, 7)}`);
      if (env.QAFILA_CONTRACT_ID && env.QAFILA_CONTRACT_ID !== dep.contractId) {
        fail('contract id', `.env ${short(env.QAFILA_CONTRACT_ID)} differs from deployments file ${short(dep.contractId)}`, 'copy contractId from deployments/testnet.json into QAFILA_CONTRACT_ID (GET /config must serve the deployed id)');
      } else if (!env.QAFILA_CONTRACT_ID) {
        warn('contract id', 'QAFILA_CONTRACT_ID empty, using the deployments file', 'copy contractId into .env so the API serves it');
      } else {
        ok('contract id', 'env and deployments file agree');
      }
    }
  } catch (e) {
    fail('deployments/testnet.json', msg(e), 'the file is malformed; redeploy or fix it by hand');
  }

  const contractId = env.QAFILA_CONTRACT_ID ?? fileId;
  if (!contractId) {
    warn('contract on-chain', 'skipped: no contract id yet', 'run pnpm deploy:testnet');
    return;
  }
  try {
    const client = readOnlyClient(contractId, cfg);
    const roles = await view(await client.get_roles());
    const adminPk = publicKeyOf(env.ADMIN_SECRET);
    if (adminPk && roles.admin === adminPk) ok('roles.admin', short(roles.admin));
    else fail('roles.admin', `on-chain ${short(roles.admin)}, env ${adminPk ? short(adminPk) : 'unset'}`, 'ADMIN_SECRET must be the key passed to the constructor');

    if (env.VERIFIER_ED25519_SECRET) {
      const expected = verifierKeyBytes(env.VERIFIER_ED25519_SECRET).toString('hex');
      const onchain = Buffer.from(roles.verifier).toString('hex');
      if (expected === onchain) ok('roles.verifier', `${onchain.slice(0, 12)}… matches VERIFIER_ED25519_SECRET`);
      else fail('roles.verifier', `on-chain ${onchain.slice(0, 12)}…, env ${expected.slice(0, 12)}…`, 'rotate with set_verifier or fix VERIFIER_ED25519_SECRET; attestations will trap otherwise');
    }

    if (roles.agent) {
      const agentPk = publicKeyOf(env.AGENT_SIGNER_SECRET);
      const matches = roles.agent === env.AGENT_SMART_ACCOUNT_ID || roles.agent === agentPk;
      if (matches) ok('roles.agent', `${short(roles.agent)} (${roles.agent.startsWith('C') ? 'smart account' : 'G key'})`);
      else warn('roles.agent', `${short(roles.agent)} is neither AGENT_SMART_ACCOUNT_ID nor the AGENT_SIGNER_SECRET key`, 'call set_agent with the agent the API signs with');
    } else {
      fail('roles.agent', 'no agent set', 'deploy script or admin must call set_agent');
    }

    if (env.CHARITY_ADDRESS && roles.charity !== env.CHARITY_ADDRESS) fail('roles.charity', `on-chain ${short(roles.charity)}`, 'CHARITY_ADDRESS differs from the contract; set_charity or fix .env');
    else ok('roles.charity', short(roles.charity));
    if (env.TREASURY_ADDRESS && roles.treasury !== env.TREASURY_ADDRESS) fail('roles.treasury', `on-chain ${short(roles.treasury)}`, 'TREASURY_ADDRESS differs from the contract; set_treasury or fix .env');
    else ok('roles.treasury', short(roles.treasury));
    if (env.SETTLEMENT_TOKEN_ID && roles.settlement !== env.SETTLEMENT_TOKEN_ID) fail('roles.settlement', `on-chain ${short(roles.settlement)}`, 'SETTLEMENT_TOKEN_ID must be the qUSD SAC the contract was deployed with');
    else ok('roles.settlement', short(roles.settlement));
    if (roles.paused) warn('paused', 'contract is paused', 'unpause before the demo');
    else ok('paused', `false, next deal id ${roles.next_deal_id.toString()}`);

    const config = await view(await client.get_config());
    ok(
      'config',
      `markup<=${config.max_markup_bps}bps deposit<=${config.max_deposit_bps}bps investors<=${config.max_investors_per_deal} tenor>=${config.min_tenor_secs}s grace ${config.grace_secs}s security ${config.min_security_bps}/${config.security_step_bps}/${config.security_floor_bps}bps ext<=${config.max_extension_secs}s limit ${(config.base_importer_limit / 10_000_000n).toString()}+${(config.limit_step / 10_000_000n).toString()}`,
    );
  } catch (e) {
    fail('contract on-chain', `${short(contractId)}: ${msg(e)}`, 'the id does not resolve on this network; redeploy or fix QAFILA_CONTRACT_ID');
  }
}

async function checkAccounts(env: ChainEnv, cfg: NetworkConfig): Promise<void> {
  const code = env.SETTLEMENT_TOKEN_CODE;
  const issuer = env.SETTLEMENT_TOKEN_ISSUER;
  const xlmOf = async (label: string, pk: string | undefined, min: number) => {
    if (!pk) return;
    try {
      const acc = await fetchAccount(cfg.horizonUrl, pk);
      const native = Number(acc.balances.find((b) => b.asset_type === 'native')?.balance ?? '0');
      if (native >= min) ok(`${label} xlm`, `${native.toFixed(2)} XLM`);
      else fail(`${label} xlm`, `${native.toFixed(2)} XLM < ${min}`, `fund ${pk} (friendbot on testnet)`);
      return acc;
    } catch (e) {
      if (e instanceof HorizonNotFound) fail(`${label} xlm`, 'account does not exist', `fund ${pk} (friendbot on testnet)`);
      else fail(`${label} xlm`, msg(e), 'check Horizon');
      return undefined;
    }
  };
  const qusdOf = async (label: string, pk: string | undefined, min: number) => {
    if (!pk || !issuer) return;
    try {
      const acc = await fetchAccount(cfg.horizonUrl, pk);
      const bal = findBalance(acc, code, issuer);
      if (!bal) fail(`${label} ${code}`, 'no trustline', `stellar tx new change-trust --line ${code}:${issuer} --source-account <${label}>`);
      else if (Number(bal.balance) >= min) ok(`${label} ${code}`, `${Number(bal.balance).toLocaleString('en-US')} ${code}`);
      else fail(`${label} ${code}`, `${bal.balance} < ${min}`, `mint ${code} from the issuer to ${pk}`);
    } catch (e) {
      fail(`${label} ${code}`, msg(e), `fund ${pk}`);
    }
  };
  await xlmOf('relayer', publicKeyOf(env.RELAYER_SECRET), XLM_MIN);
  await xlmOf('funder', publicKeyOf(env.SHARE_ISSUER_FUNDER_SECRET), XLM_MIN);
  await xlmOf('admin', publicKeyOf(env.ADMIN_SECRET), XLM_MIN);
  await xlmOf('faucet', publicKeyOf(env.FAUCET_SECRET), 5);
  await qusdOf('faucet', publicKeyOf(env.FAUCET_SECRET), QUSD_MIN);
  await qusdOf('coinvest', publicKeyOf(env.COINVEST_SECRET), QUSD_MIN);

  for (const [label, addr] of [
    ['charity', env.CHARITY_ADDRESS],
    ['treasury', env.TREASURY_ADDRESS],
  ] as const) {
    if (!addr) continue;
    if (addr.startsWith('C')) {
      ok(`${label} trustline`, 'contract address, no trustline needed');
      continue;
    }
    if (!issuer) continue;
    try {
      const acc = await fetchAccount(cfg.horizonUrl, addr);
      if (hasTrustline(acc, code, issuer)) ok(`${label} trustline`, `${code} trustline present`);
      else fail(`${label} trustline`, `no ${code} trustline: sweeps would fail`, `stellar tx new change-trust --line ${code}:${issuer} --source-account <${label}>`);
    } catch (e) {
      fail(`${label} trustline`, msg(e), `fund ${addr} and add the ${code} trustline`);
    }
  }
}

async function checkAgentAccount(env: ChainEnv, cfg: NetworkConfig): Promise<void> {
  const id = env.AGENT_SMART_ACCOUNT_ID;
  if (!id) {
    warn('agent smart account', 'AGENT_SMART_ACCOUNT_ID not set; the agent is the plain G key of AGENT_SIGNER_SECRET', 'optional: deploy the OZ smart account (contracts/spikes/sp6) and set_agent');
    return;
  }
  if (!StrKey.isValidContract(id)) {
    fail('agent smart account', 'AGENT_SMART_ACCOUNT_ID is not a contract address', 'fix AGENT_SMART_ACCOUNT_ID');
    return;
  }
  try {
    const rpc = makeRpc(cfg);
    const key = new Contract(id).getFootprint();
    const entries = await rpc.getLedgerEntries(key);
    if (entries.entries.length > 0) ok('agent smart account', `${short(id)} exists (ttl to ledger ${entries.entries[0]?.liveUntilLedgerSeq ?? '?'})`);
    else fail('agent smart account', `${short(id)} has no instance entry`, 'redeploy the agent smart account or clear AGENT_SMART_ACCOUNT_ID');
  } catch (e) {
    fail('agent smart account', msg(e), 'check the id and the RPC');
  }
}

function echoFlags(): void {
  const on = FLAGS.filter((f) => process.env[f] === 'true');
  const off = FLAGS.filter((f) => process.env[f] !== 'true');
  ok('feature flags', `on: ${on.join(', ') || 'none'}; off: ${off.join(', ') || 'none'}`);
}

function printTable(): number {
  const w = Math.max(...rows.map((r) => r.check.length), 5);
  const icon: Record<Status, string> = { OK: 'OK  ', WARN: 'WARN', FAIL: 'FAIL' };
  for (const r of rows) {
    console.log(`${icon[r.status]}  ${r.check.padEnd(w)}  ${r.detail}`);
    if (r.fix && r.status !== 'OK') console.log(`${' '.repeat(6 + w)}  -> ${r.fix}`);
  }
  const fails = rows.filter((r) => r.status === 'FAIL').length;
  const warns = rows.filter((r) => r.status === 'WARN').length;
  console.log(`\n${rows.length - fails - warns} ok, ${warns} warn, ${fails} fail`);
  return fails;
}

async function main(): Promise<void> {
  const env = await checkEnv();
  if (env) {
    const cfg = networkConfig(env);
    ok('network', `${cfg.network} ("${cfg.passphrase}")`);
    const rpcUp = await checkRpc(cfg);
    const horizonUp = await checkHorizon(cfg);
    if (rpcUp) await checkContract(env, cfg);
    else warn('contract on-chain', 'skipped: RPC down');
    if (horizonUp) await checkAccounts(env, cfg);
    else warn('accounts', 'skipped: Horizon down');
    if (rpcUp) await checkAgentAccount(env, cfg);
  }
  echoFlags();
  const fails = printTable();
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(`doctor crashed: ${msg(e)}`);
  process.exit(1);
});
