/**
 * Offline chain for development and e2e against the mock API (CLAUDE.md: mock mode works
 * offline). Compiled in only when NEXT_PUBLIC_MOCK_CHAIN=1; production never includes it.
 */
import { StrKey } from '@stellar/stellar-sdk';
import { API_BASE } from '../api/client';
import { authHeaders } from '../session';

export const MOCK_CHAIN = process.env['NEXT_PUBLIC_MOCK_CHAIN'] === '1';

export async function mockChainCall(fn: string, args: Record<string, unknown>): Promise<{ hash: string; result?: string }> {
  const res = await fetch(`${API_BASE}/mock/chain`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ fn, args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v])) }),
  });
  const body = (await res.json().catch(() => ({}))) as { hash?: string; result?: string; error?: { code: string; message: string } };
  if (!res.ok) {
    const err = new Error(body.error?.message ?? 'mock chain call failed') as Error & { contractErrorName?: string };
    err.contractErrorName = body.error?.code;
    throw err;
  }
  return { hash: body.hash ?? '', result: body.result };
}

export function mockWalletAddress(): string {
  // A stable, valid contract address per browser for the offline mock (random 32 bytes, StrKey-encoded).
  const key = 'qafila.mock-wallet';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing && StrKey.isValidContract(existing)) return existing;
  } catch {
    /* ignore */
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const s = StrKey.encodeContract(Buffer.from(bytes));
  try {
    window.localStorage.setItem(key, s);
  } catch {
    /* ignore */
  }
  return s;
}
