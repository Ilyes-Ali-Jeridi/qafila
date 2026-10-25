/**
 * Sessions, profile, KYC-lite, KYB, QR join, faucet, wallet link (PLAN 4.3 to 4.5,
 * FLOWS 9, .shared/auth-contract.md). The browser never talks to GoTrue: /auth/otp
 * and /auth/verify proxy it through Kong server-side.
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { FaucetResponseSchema, JoinRequest, KybRequest, KycRequest, KycResponseSchema, MeSchema, OkSchema, PortfolioSchema, RegisterDocumentRequest, RegisterDocumentResponseSchema, WalletLinkRequest, expectedProfit, parseAmount, requiredSecurity, type Me, type PortfolioPosition } from '@qafila/shared';
import { profileFor, requireUser, type Role } from '../auth.js';
import { audit, enqueue } from '../db/repo.js';
import { deals, documents, importers, onchainEvents, profiles } from '../db/schema.js';
import { ApiError, reply } from '../lib/http.js';
import { signHs256 } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';
import { rateLimit, clientIp } from '../lib/ratelimit.js';
import { ONCHAIN_STATUS } from '../services/deals.js';
import { readJson, type Vars } from './_shared.js';

export const auth = new Hono<{ Variables: Vars }>();
const log = logger.child({ module: 'auth' });

const OtpRequest = z.object({ email: z.string().email() });
const VerifyRequest = z.object({ email: z.string().email(), code: z.string().min(4).max(12), walletAddress: z.string().regex(/^[GC][A-Z2-7]{55}$/).optional(), walletKind: z.enum(['smart_account', 'g_account']).optional() });

function gotrue(env: Vars['env']): { url: string; key: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new ApiError(503, 'auth_unavailable', 'SUPABASE_URL or SUPABASE_ANON_KEY is not configured');
  return { url: `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`, key: env.SUPABASE_ANON_KEY };
}

auth.post('/auth/otp', rateLimit('otp', 120, 10 * 60 * 1000), async (c) => {
  const { email } = await readJson(c, OtpRequest);
  const g = gotrue(c.get('env'));
  const res = await fetch(`${g.url}/otp`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: g.key }, body: JSON.stringify({ email, create_user: true }), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    log.warn({ status: res.status }, 'otp send failed');
    throw new ApiError(503, 'otp_failed', 'could not send the code; try again in a minute');
  }
  return reply(c, OkSchema, { ok: true });
});

auth.post('/auth/verify', rateLimit('otp-verify', 240, 10 * 60 * 1000), async (c) => {
  const body = await readJson(c, VerifyRequest);
  const env = c.get('env');
  const g = gotrue(env);
  const res = await fetch(`${g.url}/verify`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: g.key }, body: JSON.stringify({ type: 'email', email: body.email, token: body.code }), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new ApiError(401, 'bad_code', 'the code is wrong or expired');
  const session = (await res.json()) as { access_token: string; expires_in?: number; expires_at?: number; user: { id: string; email?: string } };
  const svc = c.get('svc');
  let user = await profileFor(svc.db, session.user.id, session.user.email ?? body.email);
  if (body.walletAddress) {
    await svc.db.update(profiles).set({ walletAddress: body.walletAddress, walletKind: body.walletKind ?? (body.walletAddress.startsWith('C') ? 'smart_account' : 'g_account') }).where(eq(profiles.id, user.profileId)).catch(() => undefined);
    user = { ...user, walletAddress: body.walletAddress };
  }
  const expiresAt = session.expires_at ? new Date(session.expires_at * 1000).toISOString() : new Date(Date.now() + (session.expires_in ?? 3600) * 1000).toISOString();
  return c.json({ token: session.access_token, expiresAt, profile: await meOf(c, user.profileId) });
});

/** Non-production helper for demos: the last OTP mail from the local mail catcher. */
auth.get('/auth/dev-otp', async (c) => {
  const env = c.get('env');
  if (env.NODE_ENV === 'production') throw new ApiError(404, 'not_found', 'no route');
  const email = (c.req.query('email') ?? '').toLowerCase();
  const base = process.env['INBUCKET_URL'] ?? 'http://127.0.0.1:54324';
  const codeIn = (t: string) => /\b(\d{6})\b/.exec(t)?.[1] ?? null;
  // Mailpit (current supabase CLI): list, then fetch the newest message to this address.
  try {
    const list = (await fetch(`${base}/api/v1/messages?limit=20`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json())) as { messages?: Array<{ ID: string; To?: Array<{ Address: string }> }> };
    const hit = (list.messages ?? []).find((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === email));
    if (hit) {
      const msg = (await fetch(`${base}/api/v1/message/${hit.ID}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json())) as { Text?: string; HTML?: string };
      return c.json({ code: codeIn(`${msg.Text ?? ''} ${msg.HTML ?? ''}`) });
    }
  } catch {
    /* fall through to the Inbucket shape */
  }
  const box = encodeURIComponent(email.split('@')[0] ?? '');
  const list = (await fetch(`${base}/api/v1/mailbox/${box}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => [])) as Array<{ id: string }>;
  const last = list[list.length - 1];
  if (!last) return c.json({ code: null });
  const msg = (await fetch(`${base}/api/v1/mailbox/${box}/${last.id}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json())) as { body?: { text?: string } };
  return c.json({ code: codeIn(msg.body?.text ?? '') });
});

async function meOf(c: Parameters<typeof requireUser>[0], profileId: string): Promise<Me> {
  const svc = c.get('svc');
  const env = c.get('env');
  const p = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, profileId) });
  if (!p) throw new ApiError(404, 'not_found', 'profile not found');
  const imp = await svc.db.query.importers.findFirst({ where: eq(importers.profileId, profileId) });
  const approved = p.walletAddress ? await svc.chain.isInvestorApproved(p.walletAddress).catch(() => false) : false;
  let importerBlock: Me['importer'] = null;
  if (imp) {
    const stats = p.walletAddress ? await svc.chain.importerStats(p.walletAddress).catch(() => null) : null;
    const limit = p.walletAddress ? await svc.chain.importerLimit(p.walletAddress).catch(() => 0n) : 0n;
    const onTime = stats?.on_time ?? 0;
    const bps = Number((requiredSecurity(10_000n, onTime, { minSecurityBps: env.MIN_SECURITY_BPS, securityStepBps: env.SECURITY_STEP_BPS, securityFloorBps: env.SECURITY_FLOOR_BPS }) * 10000n) / 10_000n);
    importerBlock = {
      legalName: imp.legalName,
      country: imp.country,
      registrationNumber: imp.registrationNumber ?? '',
      kybStatus: imp.kybStatus as Me['profile']['kycStatus'],
      limit: limit.toString(),
      openExposure: stats?.open_exposure ?? '0',
      nextSecurityBps: bps,
      stats: stats ?? { on_time: 0, late: 0, defaulted: 0, total_repaid: '0', open_exposure: '0' },
      faucetGrant: imp.faucetGrantTx ? { amount: ((imp.documents as unknown as { faucetAmount?: string } | null)?.faucetAmount ?? '0'), txHash: imp.faucetGrantTx } : null,
    };
  }
  return {
    profile: { id: p.id, displayName: p.displayName, email: p.email, country: p.country, roles: p.roles as Role[], walletAddress: p.walletAddress as Me['profile']['walletAddress'], walletKind: p.walletKind as Me['profile']['walletKind'], kycStatus: p.kycStatus as Me['profile']['kycStatus'], joinedVia: p.joinedVia, createdAt: p.createdAt.toISOString() },
    investorApproved: approved,
    investorApproveTxHash: p.kycApprovedTx,
    importer: importerBlock,
  };
}

auth.get('/me', async (c) => {
  const u = requireUser(c);
  return reply(c, MeSchema, await meOf(c, u.profileId));
});

auth.post('/wallet/link', async (c) => {
  const u = requireUser(c);
  const body = await readJson(c, WalletLinkRequest);
  const svc = c.get('svc');
  const taken = await svc.db.query.profiles.findFirst({ where: eq(profiles.walletAddress, body.address) });
  if (taken && taken.id !== u.profileId) throw new ApiError(409, 'wallet_taken', 'this wallet is linked to another profile');
  await svc.db.update(profiles).set({ walletAddress: body.address, walletKind: body.kind }).where(eq(profiles.id, u.profileId));
  return reply(c, OkSchema, { ok: true });
});

/** Wallet-only identity for testnet join and faucet routes (display only, never for funds). */
async function walletUser(c: Parameters<typeof requireUser>[0]): Promise<{ profileId: string; walletAddress: string }> {
  const u = c.get('user');
  const header = c.req.header('x-wallet-address');
  const svc = c.get('svc');
  if (u?.walletAddress) return { profileId: u.profileId, walletAddress: u.walletAddress };
  const addr = header ?? u?.walletAddress;
  if (!addr || !/^[GC][A-Z2-7]{55}$/.test(addr)) throw new ApiError(401, 'unauthorized', 'sign in or send X-Wallet-Address');
  if (u) {
    await svc.db.update(profiles).set({ walletAddress: addr, walletKind: addr.startsWith('C') ? 'smart_account' : 'g_account' }).where(eq(profiles.id, u.profileId)).catch(() => undefined);
    return { profileId: u.profileId, walletAddress: addr };
  }
  const existing = await svc.db.query.profiles.findFirst({ where: eq(profiles.walletAddress, addr) });
  if (existing) return { profileId: existing.id, walletAddress: addr };
  const [row] = await svc.db.insert(profiles).values({ authUserId: `wallet:${addr}`, displayName: addr.slice(0, 4) + '…' + addr.slice(-4), walletAddress: addr, walletKind: addr.startsWith('C') ? 'smart_account' : 'g_account', roles: ['investor'] }).returning();
  return { profileId: row!.id, walletAddress: addr };
}

async function approveOnChain(c: Parameters<typeof requireUser>[0], profileId: string, walletAddress: string): Promise<string | null> {
  const svc = c.get('svc');
  try {
    const already = await svc.chain.isInvestorApproved(walletAddress);
    if (already) {
      await svc.db.update(profiles).set({ kycStatus: 'approved' }).where(eq(profiles.id, profileId));
      return (await svc.db.query.profiles.findFirst({ where: eq(profiles.id, profileId) }))?.kycApprovedTx ?? null;
    }
    const tx = await svc.chain.approveInvestor(walletAddress);
    await svc.db.update(profiles).set({ kycStatus: 'approved', kycApprovedTx: tx.txHash }).where(eq(profiles.id, profileId));
    return tx.txHash;
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'approve_investor failed; queued');
    await svc.db.update(profiles).set({ kycStatus: 'pending' }).where(eq(profiles.id, profileId));
    await enqueue(svc.db, 'approve_investor', { profileId, walletAddress }, { dedupeKey: `approve:${walletAddress}` });
    return null;
  }
}

async function faucetGrant(c: Parameters<typeof requireUser>[0], profileId: string, walletAddress: string, amount: bigint, once = true): Promise<{ amount: string; txHash: string; mode: 'live' | 'mock' } | null> {
  const svc = c.get('svc');
  const env = c.get('env');
  if (env.STELLAR_NETWORK === 'mainnet') return null;
  if (once) {
    const prior = await svc.db.query.onchainEvents.findFirst({ where: and(eq(onchainEvents.eventType, 'faucet'), eq(onchainEvents.txHash, `faucet:${walletAddress}`)) });
    if (prior) return null;
  }
  try {
    const tx = await svc.chain.faucet(walletAddress, amount);
    await svc.db.insert(onchainEvents).values({ contractId: 'faucet', ledger: tx.ledger ?? 0, txHash: once ? `faucet:${walletAddress}` : tx.txHash, eventIndex: 0, eventType: 'faucet', data: { to: walletAddress, amount: amount.toString(), txHash: tx.txHash, profileId } }).onConflictDoNothing();
    return { amount: amount.toString(), txHash: tx.txHash, mode: tx.mode === 'mock' ? 'mock' : 'live' };
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'faucet failed; queued');
    await enqueue(svc.db, 'faucet_grant', { profileId, walletAddress, amount: amount.toString() }, { dedupeKey: `faucet:${walletAddress}:${amount}` });
    return null;
  }
}

/** KYC-lite (PLAN 4.4): auto-approved, the API calls approve_investor at once. */
auth.post('/kyc', rateLimit('kyc', 300, 60 * 60 * 1000), async (c) => {
  const body = await readJson(c, KycRequest);
  const { profileId, walletAddress } = await walletUser(c);
  const svc = c.get('svc');
  await svc.db.update(profiles).set({ displayName: body.displayName, country: body.country, ...(body.email ? { email: body.email } : {}), roles: (await rolesPlus(c, profileId, 'investor')), kycStatus: 'pending' }).where(eq(profiles.id, profileId));
  const txHash = await approveOnChain(c, profileId, walletAddress);
  const faucet = await faucetGrant(c, profileId, walletAddress, parseAmount(c.get('env').FAUCET_AMOUNT));
  return reply(c, KycResponseSchema, { kycStatus: txHash ? 'approved' : 'pending', approveTxHash: txHash, faucet });
});

/** S6 QR join: passkey only, risk box, approve on-chain, faucet, invest. */
auth.post('/join', rateLimit('join', 300, 60 * 60 * 1000), async (c) => {
  const body = await readJson(c, JoinRequest);
  const svc = c.get('svc');
  if (!c.get('env').FF_QR_JOIN) throw new ApiError(404, 'not_found', 'join is off');
  let p = await svc.db.query.profiles.findFirst({ where: eq(profiles.walletAddress, body.address) });
  if (!p) {
    const [row] = await svc.db.insert(profiles).values({ authUserId: `wallet:${body.address}`, displayName: body.displayName, country: body.country ?? null, email: body.email ?? null, walletAddress: body.address, walletKind: body.address.startsWith('C') ? 'smart_account' : 'g_account', roles: ['investor'], joinedVia: 'hackmeridian', kycStatus: 'pending' }).returning();
    p = row!;
  } else await svc.db.update(profiles).set({ displayName: body.displayName, ...(body.country ? { country: body.country } : {}), ...(body.email ? { email: body.email } : {}), joinedVia: p.joinedVia ?? 'hackmeridian' }).where(eq(profiles.id, p.id));
  const txHash = await approveOnChain(c, p.id, body.address);
  const faucet = await faucetGrant(c, p.id, body.address, parseAmount(c.get('env').FAUCET_AMOUNT));
  return reply(c, KycResponseSchema, { kycStatus: txHash ? 'approved' : 'pending', approveTxHash: txHash, faucet });
});

auth.post('/faucet', rateLimit('faucet', 300, 24 * 60 * 60 * 1000, (c) => clientIp(c)), async (c) => {
  const { profileId, walletAddress } = await walletUser(c);
  const env = c.get('env');
  if (env.STELLAR_NETWORK === 'mainnet') throw new ApiError(404, 'not_found', 'no faucet on mainnet');
  const r = await faucetGrant(c, profileId, walletAddress, parseAmount(env.FAUCET_AMOUNT));
  if (!r) throw new ApiError(409, 'faucet_done', 'this wallet already received test dollars (or the faucet is queued)');
  return reply(c, FaucetResponseSchema, r);
});

/** KYB (FLOWS I-1): company details, pending until ops approves; the faucet grant comes with the approval. */
auth.post('/kyb', async (c) => {
  const u = requireUser(c);
  const body = await readJson(c, KybRequest);
  const svc = c.get('svc');
  await svc.db.update(profiles).set({ displayName: body.displayName, country: body.country, ...(body.email ? { email: body.email } : {}), roles: await rolesPlus(c, u.profileId, 'importer') }).where(eq(profiles.id, u.profileId));
  const docs = body.documentId ? [{ documentId: body.documentId, type: 'kyb' }] : [];
  await svc.db
    .insert(importers)
    .values({ profileId: u.profileId, legalName: body.legalName, country: body.country, registrationNumber: body.registrationNumber, kybStatus: 'pending', documents: docs })
    .onConflictDoUpdate({ target: importers.profileId, set: { legalName: body.legalName, country: body.country, registrationNumber: body.registrationNumber, kybStatus: 'pending', documents: docs } });
  return reply(c, KycResponseSchema, { kycStatus: 'pending', approveTxHash: null, faucet: null });
});

/** KYB registration document: registers a pending upload, the browser PUTs the bytes to /kyb/documents/:id. */
auth.post('/kyb/documents', async (c) => {
  const u = requireUser(c);
  const body = await readJson(c, RegisterDocumentRequest);
  const svc = c.get('svc');
  const env = c.get('env');
  // KYB documents hang off a placeholder deal-less row: store them under a per-profile pseudo deal id in storage.
  const [row] = await svc.db
    .insert(documents)
    .values({ dealId: await kybDealFor(c, u.profileId), type: 'kyb', storagePath: `kyb/${u.profileId}/${body.sha256.slice(0, 12)}`, sha256: body.sha256, mime: body.mime, size: body.size, uploadedBy: u.profileId, stage: 'kyb', status: 'pending' })
    .returning();
  return reply(c, RegisterDocumentResponseSchema, { documentId: row!.id, uploadUrl: `${env.API_BASE_URL.replace(/\/$/, '')}/deals/${row!.dealId}/documents/${row!.id}`, method: 'PUT', headers: { 'content-type': body.mime } });
});

/** KYB documents need a deal row (documents.deal_id is NOT NULL): one hidden "kyb" deal per importer. */
async function kybDealFor(c: Parameters<typeof requireUser>[0], profileId: string): Promise<string> {
  const svc = c.get('svc');
  const existing = await svc.db.query.deals.findFirst({ where: and(eq(deals.importerId, profileId), eq(deals.status, 'kyb')) });
  if (existing) return existing.id;
  const [row] = await svc.db.insert(deals).values({ importerId: profileId, status: 'kyb', goodsSummary: 'KYB documents', route: { originPort: '', destinationPort: '', destinationCountry: '' } }).returning();
  return row!.id;
}

async function rolesPlus(c: Parameters<typeof requireUser>[0], profileId: string, role: Role): Promise<string[]> {
  const svc = c.get('svc');
  const p = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, profileId) });
  return [...new Set([...(p?.roles ?? []), role])];
}

/** Portfolio (PLAN 9.2): positions from indexed `invested` events plus on-chain balances and quotes. */
auth.get('/me/portfolio', async (c) => {
  const { walletAddress } = await walletUser(c);
  const svc = c.get('svc');
  const invested = await svc.db.query.onchainEvents.findMany({ where: eq(onchainEvents.eventType, 'invested'), orderBy: (e, { desc }) => [desc(e.ledger)] });
  const mine = invested.filter((e) => (e.data as Record<string, unknown>)['investor'] === walletAddress && e.dealOnchainId !== null);
  const byDeal = new Map<number, typeof mine>();
  for (const e of mine) byDeal.set(e.dealOnchainId!, [...(byDeal.get(e.dealOnchainId!) ?? []), e]);
  const positions: PortfolioPosition[] = [];
  let totalInvested = 0n;
  let totalExpected = 0n;
  let totalRealised = 0n;
  let totalClaimable = 0n;
  for (const [onchainId, evs] of byDeal) {
    const deal = await svc.db.query.deals.findFirst({ where: eq(deals.onchainId, onchainId) });
    const on = await svc.chain.getDeal(onchainId).catch(() => null);
    if (!deal || !on) continue;
    const shares = evs.reduce((s, e) => s + BigInt(String((e.data as Record<string, unknown>)['amount'] ?? '0')), 0n);
    const claimEv = await svc.db.query.onchainEvents.findFirst({ where: and(eq(onchainEvents.eventType, 'claimed'), eq(onchainEvents.dealOnchainId, onchainId)) });
    const claimed = Boolean(claimEv && (claimEv.data as Record<string, unknown>)['holder'] === walletAddress);
    const claimable = !claimed && ['Repaid', 'Cancelled', 'Liquidated'].includes(on.state) ? await svc.chain.quoteClaim(walletAddress, onchainId).catch(() => 0n) : null;
    const expected = expectedProfit(shares, BigInt(on.terms.markup), BigInt(on.terms.platform_fee), BigInt(on.terms.cost));
    const realised = claimed && claimEv ? BigInt(String((claimEv.data as Record<string, unknown>)['payout'] ?? '0')) - shares : on.state === 'Repaid' ? (shares * BigInt(on.distributable)) / BigInt(on.funded || '1') - shares : null;
    const route = deal.route as { originPort: string; destinationPort: string };
    positions.push({ dealId: deal.id, number: deal.number, onchainId, goodsSummary: deal.goodsSummary, route: `${route.originPort} to ${route.destinationPort}`, state: on.state, shares: shares.toString(), expectedProfit: expected.toString(), realisedProfit: realised?.toString() ?? null, claimable: claimable?.toString() ?? null, claimed, claimTxHash: claimed ? (claimEv?.txHash ?? null) : null, investTxHash: evs[evs.length - 1]?.txHash ?? null, investedAt: (evs[evs.length - 1]?.ledgerClosedAt ?? evs[evs.length - 1]?.createdAt ?? new Date()).toISOString(), dueAt: on.due_at || null, tenorSecs: on.terms.tenor_secs });
    totalInvested += shares;
    totalExpected += expected;
    totalRealised += realised && realised > 0n ? realised : 0n;
    totalClaimable += claimable ?? 0n;
  }
  const refundOwed = await svc.chain.refundOf(walletAddress).catch(() => 0n);
  return reply(c, PortfolioSchema, { positions, totals: { invested: totalInvested.toString(), expectedProfit: totalExpected.toString(), realisedProfit: totalRealised.toString(), claimable: totalClaimable.toString() }, refundOwed: refundOwed.toString() });
});

/** Dev-only: mint a session token for tests without GoTrue (NODE_ENV != production and DEV_AUTH_BYPASS). */
auth.post('/auth/dev-token', async (c) => {
  const env = c.get('env');
  if (env.NODE_ENV === 'production' || !(env.DEV_AUTH_BYPASS || env.NODE_ENV === 'test')) throw new ApiError(404, 'not_found', 'no route');
  const body = await readJson(c, z.object({ sub: z.string().min(1), email: z.string().email().optional(), roles: z.array(z.enum(['investor', 'importer', 'ops', 'sharia'])).optional() }));
  const svc = c.get('svc');
  const u = await profileFor(svc.db, body.sub, body.email ?? `${body.sub}@dev.local`, body.roles ?? []);
  const secret = env.SUPABASE_JWT_SECRET ?? env.JWT_SECRET ?? 'dev-secret';
  const token = signHs256({ sub: body.sub, email: u.email ?? undefined, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }, secret);
  await audit(svc.db, { actor: u.profileId, action: 'dev_token', target: body.sub });
  return c.json({ token, profileId: u.profileId });
});

export { ONCHAIN_STATUS };
