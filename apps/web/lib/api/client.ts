import type { ZodType } from 'zod';
import { ApiErrorSchema } from '@qafila/shared';
import { authHeaders } from '../session';

export const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:8787';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Plain message for a failed request, never a stack trace. */
export function describeError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 501) return 'This part of the API is not built yet.';
    if (e.status === 401) return 'Sign in to continue.';
    if (e.status === 403) return 'Your account cannot do that.';
    return e.message;
  }
  if (e instanceof TypeError && /fetch/i.test(e.message)) return 'Could not reach the server. Check your connection and try again.';
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

async function request<T>(path: string, schema: ZodType<T>, init: RequestInit = {}): Promise<T> {
  const auth = typeof window !== 'undefined' ? authHeaders() : {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...auth, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  if (res.status === 204) return schema.parse(undefined);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    const e = parsed.success ? parsed.data.error : { code: 'http_error', message: `HTTP ${res.status}`, details: undefined };
    throw new ApiRequestError(res.status, e.code, e.message, e.details);
  }
  return schema.parse(body);
}

/** Fetch and validate at the boundary. Works on the server and in the browser. */
export function apiGet<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  return request(path, schema, init);
}

export function apiPost<T>(path: string, body: unknown, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  return request(path, schema, { ...init, method: 'POST', body: JSON.stringify(body ?? {}), headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
}

export function apiPatch<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
  return request(path, schema, { method: 'PATCH', body: JSON.stringify(body ?? {}), headers: { 'content-type': 'application/json' } });
}

export function apiPut<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
  return request(path, schema, { method: 'PUT', body: JSON.stringify(body ?? {}), headers: { 'content-type': 'application/json' } });
}

/** Upload a file to a signed URL returned by POST /deals/:id/documents. */
export async function uploadToSignedUrl(url: string, method: 'PUT', headers: Record<string, string>, file: File): Promise<void> {
  const res = await fetch(url, { method, headers, body: file });
  if (!res.ok) throw new ApiRequestError(res.status, 'upload_failed', 'The upload failed. Try again.');
}

export async function sha256File(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
