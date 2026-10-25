import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const reports = new Hono<{ Variables: { env: Env } }>();

reports.get('/:id/report', () => { throw notImplemented('get /:id/report'); });
