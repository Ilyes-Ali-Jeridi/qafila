import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const wallet = new Hono<{ Variables: { env: Env } }>();

wallet.post('/link', () => { throw notImplemented('post /link'); });
