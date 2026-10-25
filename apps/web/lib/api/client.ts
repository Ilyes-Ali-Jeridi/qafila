import type { ZodType } from 'zod';
import { ApiErrorSchema } from '@qafila/shared';

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

/** Fetch and validate at the boundary. Works on the server and in the browser. */
export async function apiGet<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) }, cache: 'no-store' });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    const e = parsed.success ? parsed.data.error : { code: 'http_error', message: `HTTP ${res.status}`, details: undefined };
    throw new ApiRequestError(res.status, e.code, e.message, e.details);
  }
  return schema.parse(body);
}

export async function apiPost<T>(path: string, body: unknown, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  return apiGet(path, schema, { ...init, method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
}
