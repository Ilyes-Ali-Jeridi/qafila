import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const faucet = new Hono<{ Variables: { env: Env } }>();

faucet.post('/', () => { throw notImplemented('post /'); });
