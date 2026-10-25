import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const deals = new Hono<{ Variables: { env: Env } }>();

deals.get('/', () => { throw notImplemented('get /'); });
deals.post('/', () => { throw notImplemented('post /'); });
deals.get('/:id', () => { throw notImplemented('get /:id'); });
deals.post('/:id/verify', () => { throw notImplemented('post /:id/verify'); });
deals.post('/:id/promise', () => { throw notImplemented('post /:id/promise'); });
deals.get('/:id/tracking', () => { throw notImplemented('get /:id/tracking'); });
deals.get('/:id/tradefile', () => { throw notImplemented('get /:id/tradefile'); });
deals.post('/:id/extension-request', () => { throw notImplemented('post /:id/extension-request'); });
deals.get('/:id/purchase-order', () => { throw notImplemented('get /:id/purchase-order'); });
