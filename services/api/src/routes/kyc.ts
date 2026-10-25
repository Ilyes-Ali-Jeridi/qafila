import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const kyc = new Hono<{ Variables: { env: Env } }>();

kyc.post('/', () => { throw notImplemented('post /'); });
