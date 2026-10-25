/**
 * Notifications (PLAN 8.5, FLOWS 9): deal listed, funded, deposit paid, shipment
 * confirmed, sale ready to sign, due in 7 and 1 days, repaid and ready to claim, late
 * fee to charity, incident, deposit refunded, deposit used, due date extended,
 * verification done. Log-only when RESEND_API_KEY is empty; every message is stored.
 */
import { eq } from 'drizzle-orm';
import { formatAmount } from '@qafila/shared';
import { deals, notifications, profiles } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import type { Services } from '../services.js';

const log = logger.child({ module: 'notify' });

export interface NotifyPayload {
  kind: string;
  dealId?: string | null;
  stage?: string;
  decision?: string;
  reason?: string;
  amount?: string;
  incident?: string;
  detail?: string;
  to?: string[]; // profile ids override
}

function template(kind: string, p: NotifyPayload, deal: { number: number; goodsSummary: string } | null, appUrl: string, code: string): { subject: string; text: string } {
  const ref = deal ? `deal ${deal.number} (${deal.goodsSummary})` : 'your deal';
  const link = deal ? `${appUrl}/deals` : appUrl;
  const amt = p.amount ? formatAmount(p.amount, code) : '';
  switch (kind) {
    case 'verification_done':
      return { subject: `Qafila: ${p.stage === 'shipment' ? 'shipment check' : 'screening'} result for ${ref}`, text: `The ${p.stage === 'shipment' ? 'shipment check' : 'screening'} of ${ref} finished: ${p.decision}. Open ${link} to read the report and what to fix.` };
    case 'deal_listed':
      return { subject: `Qafila: ${ref} is listed`, text: `${ref} is now listed for funding. Investors can fund it until the deadline. ${link}` };
    case 'funded':
      return { subject: `Qafila: ${ref} is fully funded`, text: `${ref} reached its funding target. The agent will pay the supplier deposit next. ${link}` };
    case 'deposit_paid':
      return { subject: `Qafila: supplier deposit paid for ${ref}`, text: `The supplier deposit for ${ref} was paid${amt ? ` (${amt})` : ''}. The supplier can ship. ${link}` };
    case 'shipment_confirmed':
      return { subject: `Qafila: shipment confirmed for ${ref}`, text: `The carrier's loading record matched the bill of lading of ${ref}. The balance was paid and Qafila now owns the goods. ${link}` };
    case 'sale_ready':
      return { subject: `Qafila: sign the sale for ${ref}`, text: `Qafila owns the goods of ${ref}. Sign the sale at the fixed price within the accept window to take ownership. ${link}` };
    case 'due_7d':
      return { subject: `Qafila: ${ref} is due in 7 days`, text: `The price of ${ref} is due in 7 days. Repay in one or more payments. ${link}` };
    case 'due_1d':
      return { subject: `Qafila: ${ref} is due tomorrow`, text: `The price of ${ref} is due tomorrow. A late payment adds a fixed late fee that goes to charity. ${link}` };
    case 'repaid_claim':
      return { subject: `Qafila: ${ref} repaid, claim your share`, text: `${ref} was repaid. Your principal plus profit is ready: open ${link} and press Claim, or wait and the agent claims for you after 24 hours.` };
    case 'late_fee_charity':
      return { subject: `Qafila: late fee for ${ref} goes to charity`, text: `The final payment of ${ref} was late. The fixed late fee${amt ? ` of ${amt}` : ''} is owed to the charity address, never to investors or Qafila. ${link}` };
    case 'security_refunded':
      return { subject: `Qafila: your deposit for ${ref} is refunded`, text: `${ref} did not go ahead${p.reason ? ` (${p.reason})` : ''} and it was not your fault. Your security deposit is back under "Money to collect". ${link}` };
    case 'security_used':
      return { subject: `Qafila: deposit used for ${ref}`, text: `${ref} was stopped${p.reason ? ` (${p.reason})` : ''}. Under the promise, the actual loss is covered by your security deposit; the rest comes back to you after the deal is wound up. ${link}` };
    case 'due_extended':
      return { subject: `Qafila: more time for ${ref}`, text: `The due date of ${ref} was extended once. The price does not change. ${link}` };
    case 'incident':
      return { subject: `Qafila ops: incident ${p.incident ?? ''} on ${ref}`, text: `${p.detail ?? ''}\n${appUrl}/ops` };
    default:
      return { subject: `Qafila: update on ${ref}`, text: `${kind}: ${p.detail ?? ''} ${link}` };
  }
}

export async function sendNotification(svc: Services, p: NotifyPayload): Promise<number> {
  const deal = p.dealId ? await svc.db.query.deals.findFirst({ where: eq(deals.id, p.dealId) }) : null;
  const recipients = new Set<string>(p.to ?? []);
  if (!p.to) {
    if (deal) recipients.add(deal.importerId);
    if (['funded', 'shipment_confirmed', 'repaid_claim'].includes(p.kind) && deal?.onchainId) {
      const holders = await svc.chain.holders(deal.onchainId).catch(() => []);
      if (holders.length) {
        const rows = await svc.db.query.profiles.findMany({ where: (t, { inArray }) => inArray(t.walletAddress, holders) });
        rows.forEach((r) => recipients.add(r.id));
      }
    }
    if (p.kind === 'incident') {
      const ops = await svc.db.query.profiles.findMany({ where: (t, { sql }) => sql`'ops' = ANY(${t.roles})` });
      ops.forEach((r) => recipients.add(r.id));
    }
  }
  const { subject, text } = template(p.kind, p, deal ? { number: deal.number, goodsSummary: deal.goodsSummary } : null, svc.env.APP_BASE_URL, svc.env.SETTLEMENT_TOKEN_CODE);
  let sent = 0;
  for (const profileId of recipients) {
    const prof = await svc.db.query.profiles.findFirst({ where: eq(profiles.id, profileId) });
    const to = prof?.email ?? (p.kind === 'incident' ? svc.env.OPS_EMAIL : null);
    const [row] = await svc.db.insert(notifications).values({ profileId, kind: p.kind, dealId: deal?.id ?? null, payload: { subject, text, to } }).returning();
    if (!to) {
      log.info({ kind: p.kind, profile: profileId, deal: deal?.id }, 'notification stored (no email on file)');
      continue;
    }
    const r = await svc.adapters.resend({ to, subject, text, idempotencyKey: `${row!.id}` }, svc.adapters.ctx.resend);
    await svc.db.update(notifications).set({ sentAt: r.status === 'ok' ? new Date() : null, error: r.status === 'ok' ? null : r.error }).where(eq(notifications.id, row!.id));
    log.info({ kind: p.kind, profile: profileId, mode: r.mode, status: r.status }, r.mode === 'mock' ? 'notification (LOG ONLY, no RESEND_API_KEY)' : 'notification sent');
    if (r.status === 'ok') sent++;
  }
  return sent;
}
