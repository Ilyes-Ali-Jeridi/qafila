import { Hono } from 'hono';
import type { Env } from '../env.js';
import { notImplemented } from '../lib/http.js';

export const documents = new Hono<{ Variables: { env: Env } }>();

documents.post('/:id/documents', () => { throw notImplemented('post /:id/documents'); });
