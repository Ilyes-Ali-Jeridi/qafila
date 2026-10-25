/** Adapter factory wired from the environment. Per-adapter modes override ADAPTER_MODE. */
import type { Env } from '../env.js';
import { adapterContext, MemoryCache, type AdapterCache, type AdapterContext, type AdapterMode } from './base.js';
import { createLlm, type LlmClient } from './llm.js';
import { gleifLookup } from './gleif.js';
import { makeQccLookup } from './qcc.js';
import { makeFx } from './fx.js';
import { makeReflector } from './reflector.js';
import { makeOpenSanctions } from './opensanctions.js';
import { makeShipsgo } from './shipsgo.js';
import { makeResend } from './resend.js';
import { createLocalStorage, createSupabaseStorage, type Storage } from './storage.js';
import { makeTrustlessWork, type TrustlessWorkClient } from './trustlesswork.js';

export interface Adapters {
  llm: LlmClient;
  gleif: typeof gleifLookup;
  qcc: ReturnType<typeof makeQccLookup> | null;
  fx: ReturnType<typeof makeFx>;
  reflector: ReturnType<typeof makeReflector>;
  opensanctions: ReturnType<typeof makeOpenSanctions>;
  shipsgo: ReturnType<typeof makeShipsgo>;
  resend: ReturnType<typeof makeResend>;
  /** S2 escrow (PLAN 10.1); null unless FF_TRUSTLESS_WORK is on. */
  trustlesswork: TrustlessWorkClient | null;
  storage: Storage;
  /** Context per adapter name (mode differs per adapter). */
  ctx: Record<'llm' | 'registry' | 'shipsgo' | 'opensanctions' | 'reflector' | 'fx' | 'resend', AdapterContext>;
  modes: Record<string, AdapterMode | 'off'>;
}

export function modeFor(env: Env, specific: AdapterMode | undefined, hasKey: boolean): AdapterMode {
  const m = specific ?? env.ADAPTER_MODE;
  if (m === 'mock') return 'mock';
  return hasKey ? 'live' : 'mock';
}

export function createAdapters(env: Env, opts: { cache?: AdapterCache | null; record?: boolean; fixturesDir?: string } = {}): Adapters {
  const cache = opts.cache === undefined ? new MemoryCache() : opts.cache;
  const mk = (mode: AdapterMode): AdapterContext => adapterContext({ mode, cache, record: opts.record, fixturesDir: opts.fixturesDir });
  const llmMode = modeFor(env, env.LLM_MODE, env.LLM_PROVIDER === 'bedrock' ? true : Boolean(env.ANTHROPIC_API_KEY));
  const registryMode = modeFor(env, env.REGISTRY_MODE, true);
  const shipsgoMode = modeFor(env, env.SHIPSGO_MODE, Boolean(env.SHIPSGO_API_KEY));
  const sanctionsMode = modeFor(env, env.OPENSANCTIONS_MODE, Boolean(env.OPENSANCTIONS_API_KEY));
  const reflectorMode = modeFor(env, env.REFLECTOR_MODE, true);
  const fxMode = modeFor(env, env.FX_MODE, true);
  const resendMode: AdapterMode = env.RESEND_API_KEY && env.ADAPTER_MODE === 'live' ? 'live' : 'mock';
  const trustlessMode = modeFor(env, env.TRUSTLESS_WORK_MODE, Boolean(env.TRUSTLESS_WORK_API_KEY));
  const trustlesswork = env.FF_TRUSTLESS_WORK
    ? makeTrustlessWork({ mode: trustlessMode, baseUrl: env.TRUSTLESS_WORK_BASE_URL, apiKey: env.TRUSTLESS_WORK_API_KEY, networkPassphrase: env.NETWORK_PASSPHRASE, viewerUrl: env.TRUSTLESS_WORK_VIEWER_URL, feeBps: env.TRUSTLESS_WORK_FEE_BPS })
    : null;

  const storage: Storage =
    env.STORAGE_MODE === 'supabase' && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? createSupabaseStorage({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY })
      : createLocalStorage({ apiBaseUrl: env.API_BASE_URL, secret: env.JWT_SECRET ?? 'dev-local-storage-secret' });

  return {
    llm: createLlm({ provider: env.LLM_PROVIDER, region: env.AWS_REGION, models: { reason: env.LLM_MODEL_REASON, fast: env.LLM_MODEL_FAST }, anthropicApiKey: env.ANTHROPIC_API_KEY }),
    gleif: gleifLookup,
    qcc: env.QCC_API_KEY ? makeQccLookup({ apiKey: env.QCC_API_KEY, secretKey: env.QCC_SECRET_KEY, baseUrl: env.QCC_BASE_URL, ekybPath: env.QCC_EKYB_PATH }) : null,
    fx: makeFx(env.FX_FALLBACK_URL),
    reflector: makeReflector({ rpcUrl: env.STELLAR_RPC_URL, passphrase: env.NETWORK_PASSPHRASE, feedId: env.REFLECTOR_FX_ID ?? 'CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W' }),
    opensanctions: makeOpenSanctions({ apiKey: env.OPENSANCTIONS_API_KEY }),
    shipsgo: makeShipsgo({ apiKey: env.SHIPSGO_API_KEY }),
    resend: makeResend({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM }),
    trustlesswork,
    storage,
    ctx: { llm: mk(llmMode), registry: mk(registryMode), shipsgo: mk(shipsgoMode), opensanctions: mk(sanctionsMode), reflector: mk(reflectorMode), fx: mk(fxMode), resend: mk(resendMode) },
    modes: {
      llm: llmMode,
      registry: registryMode,
      gleif: registryMode,
      qcc: env.QCC_API_KEY ? registryMode : 'off',
      shipsgo: shipsgoMode,
      opensanctions: sanctionsMode,
      reflector: env.FF_REFLECTOR ? reflectorMode : 'off',
      fx: fxMode,
      resend: env.RESEND_API_KEY ? resendMode : 'off',
      trustlesswork: trustlesswork ? trustlessMode : 'off',
      storage: storage.mode === 'supabase' ? 'live' : 'mock',
    },
  };
}
