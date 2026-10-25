/**
 * Email through Resend (PLAN 8.5). Without RESEND_API_KEY the adapter is log-only:
 * the message is recorded and logged as a mock, nothing is sent.
 */
import { z } from 'zod';
import { defineAdapter } from './base.js';
import { fetchJson } from '../lib/retry.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey?: string;
}

const ResendResponse = z.object({ id: z.string() });

export function makeResend(cfg: { apiKey?: string; from?: string }) {
  const from = cfg.from ?? 'Qafila <notifications@qafila.dev>';
  return defineAdapter<EmailMessage, z.infer<typeof ResendResponse>, { id: string }>({
    name: 'resend',
    keyOf: (m) => ({ key: m.idempotencyKey ?? `${m.to}:${m.subject}:${Date.now()}` }),
    fixtureName: (m) => `email-${(m.idempotencyKey ?? 'adhoc').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}`,
    cacheable: false,
    live: (m, signal) => {
      if (!cfg.apiKey) throw new Error('RESEND_API_KEY missing');
      return fetchJson('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}`, ...(m.idempotencyKey ? { 'Idempotency-Key': m.idempotencyKey } : {}) },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }),
        signal,
      });
    },
    schema: ResendResponse,
    map: (r) => r,
    mockFallback: (m) => ({ id: `log-only-${(m.idempotencyKey ?? 'adhoc').slice(0, 40)}` }),
  });
}
