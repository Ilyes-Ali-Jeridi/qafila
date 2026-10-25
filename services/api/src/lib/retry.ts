/** Timeout plus bounded retries with exponential backoff (PLAN 5.4: 10 s, 2 retries). */
export interface RetryOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  /** Return false to stop retrying (e.g. 4xx). Default retries everything. */
  retryOn?: (err: unknown) => boolean;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new TimeoutError(ms)), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || (opts.retryOn && !opts.retryOn(err))) break;
      await new Promise((r) => setTimeout(r, base * 2 ** attempt + Math.floor(Math.random() * 100)));
    }
  }
  throw lastErr;
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly body: string, url: string) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

/** Retry on network errors and 5xx/429 only. */
export const retryOnTransient = (err: unknown): boolean => {
  if (err instanceof HttpError) return err.status >= 500 || err.status === 429;
  return true;
};

export async function fetchJson(url: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, url);
  return text.length ? (JSON.parse(text) as unknown) : null;
}
