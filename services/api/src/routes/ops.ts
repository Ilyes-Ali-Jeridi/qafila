import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const ops = new Hono<{ Variables: { env: Env } }>();

ops.post('/kyc/:id/approve', () => { throw notImplemented('post /kyc/:id/approve'); });
ops.post('/deals/:id/list', () => { throw notImplemented('post /deals/:id/list'); });
ops.post('/deals/:id/pay-deposit', () => { throw notImplemented('post /deals/:id/pay-deposit'); });
ops.post('/deals/:id/abort', () => { throw notImplemented('post /deals/:id/abort'); });
ops.post('/deals/:id/override', () => { throw notImplemented('post /deals/:id/override'); });
ops.post('/deals/:id/default', () => { throw notImplemented('post /deals/:id/default'); });
ops.post('/deals/:id/recovery', () => { throw notImplemented('post /deals/:id/recovery'); });
ops.post('/deals/:id/finalize', () => { throw notImplemented('post /deals/:id/finalize'); });
ops.post('/deals/:id/extend', () => { throw notImplemented('post /deals/:id/extend'); });
ops.get('/agent', () => { throw notImplemented('get /agent'); });
ops.get('/policy', () => { throw notImplemented('get /policy'); });
ops.put('/policy', () => { throw notImplemented('put /policy'); });
