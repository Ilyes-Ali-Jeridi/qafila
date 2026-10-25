import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ZodType } from 'zod';

export class ApiError extends HTTPException {
  constructor(status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 501 | 503, code: string, message: string, details?: unknown) {
    super(status, { message, res: Response.json({ error: { code, message, details } }, { status }) });
  }
}

export const notImplemented = (what: string) => new ApiError(501, 'not_implemented', `${what} is not built yet`);

/** Validate an outgoing payload at the boundary (CLAUDE.md: zod at every boundary). */
export function reply<T>(c: Context, schema: ZodType<T>, data: unknown, status = 200) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(500, 'response_invalid', 'response failed validation', parsed.error.issues);
  }
  return c.json(parsed.data as T, status as 200);
}
