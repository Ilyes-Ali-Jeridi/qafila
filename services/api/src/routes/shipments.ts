import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const shipments = new Hono<{ Variables: { env: Env } }>();

shipments.post('/:id/shipment', () => { throw notImplemented('post /:id/shipment'); });
