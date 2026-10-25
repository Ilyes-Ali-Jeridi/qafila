import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const x402 = new Hono<{ Variables: { env: Env } }>();

x402.post('/v1/verify', () => { throw notImplemented('post /v1/verify'); });
x402.get('/v1/jobs/:id', () => { throw notImplemented('get /v1/jobs/:id'); });
