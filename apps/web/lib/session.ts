/**
 * App session abstraction. The wallet address is the identity in the UI; requests to
 * importer and ops routes carry an Authorization header from here. Track B's Supabase
 * Auth (email OTP) plugs in by calling setSessionToken(); the contract both sides follow
 * is documented in /.shared/auth-contract.md.
 */
export interface Session {
  token: string | null;
  address: string | null;
  kind: 'smart_account' | 'g_account' | null;
  label: string | null;
}

const KEY = 'qafila.session.v1';
const EMPTY: Session = { token: null, address: null, kind: null, label: null };
const listeners = new Set<() => void>();

export function readSession(): Session {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return { token: parsed.token ?? null, address: parsed.address ?? null, kind: parsed.kind ?? null, label: parsed.label ?? null };
  } catch {
    return EMPTY;
  }
}

export function writeSession(next: Partial<Session>) {
  if (typeof window === 'undefined') return;
  const merged = { ...readSession(), ...next };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}

export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Set by the auth flow (email OTP) once Track B's /auth routes exist. */
export function setSessionToken(token: string | null) {
  writeSession({ token });
}

/**
 * Headers for authenticated requests.
 * - Authorization: Bearer <jwt> once the user has a server session.
 * - Without a server session, a wallet-only session sends Bearer mock.<address>, which only
 *   the mock API accepts; the real API answers 401 and the UI shows the sign-in step.
 * - X-Wallet-Address is always sent when a wallet is connected so the API can link it.
 */
export function authHeaders(): Record<string, string> {
  const s = readSession();
  const h: Record<string, string> = {};
  if (s.address) h['x-wallet-address'] = s.address;
  if (s.token) h['authorization'] = `Bearer ${s.token}`;
  else if (s.address) h['authorization'] = `Bearer mock.${s.address}`;
  return h;
}
