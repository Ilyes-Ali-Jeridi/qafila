import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const stats = new Hono<{ Variables: { env: Env } }>();

stats.get('/', () => { throw notImplemented('get /'); });
