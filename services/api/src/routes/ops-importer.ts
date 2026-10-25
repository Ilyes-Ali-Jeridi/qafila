/** The importer view of a deal, reused by the ops detail (kept out of deals.ts to avoid a cycle). */
import { desc, eq } from 'drizzle-orm';
import type { ImporterDeal } from '@qafila/shared';
import type { AuthUser } from '../auth.js';
import { checks as checksTable, extensionRequests, promises, reports, shipments, supplierConfirmations, suppliers } from '../db/schema.js';
import { toSummary, ONCHAIN_STATUS, type DealRow, type DraftTerms } from '../services/deals.js';
import type { Services } from '../services.js';
import { documentRecords } from './_shared.js';

export async function importerDealOf(svc: Services, deal: DealRow, user: AuthUser): Promise<ImporterDeal> {
  const onchain = deal.onchainId ? await svc.chain.getDeal(deal.onchainId).catch(() => null) : null;
  const report = deal.reportId ? await svc.db.query.reports.findFirst({ where: eq(reports.id, deal.blReportId ?? deal.reportId) }) : null;
  const summary = await toSummary(svc, deal, onchain, report ? { decision: report.decision, riskScore: report.riskScore } : null, null);
  const supplier = deal.supplierId ? await svc.db.query.suppliers.findFirst({ where: eq(suppliers.id, deal.supplierId) }) : null;
  const t = (deal.terms ?? {}) as Partial<DraftTerms>;
  const promise = await svc.db.query.promises.findFirst({ where: eq(promises.dealId, deal.id), orderBy: desc(promises.createdAt) });
  const shipment = await svc.db.query.shipments.findFirst({ where: eq(shipments.dealId, deal.id) });
  const ext = await svc.db.query.extensionRequests.findFirst({ where: eq(extensionRequests.dealId, deal.id), orderBy: desc(extensionRequests.createdAt) });
  const confirmation = await svc.db.query.supplierConfirmations.findFirst({ where: eq(supplierConfirmations.dealId, deal.id) });
  const stage = (onchain ? ONCHAIN_STATUS[onchain.state] : deal.status) as ImporterDeal['stage'];
  const fixCount = report ? (await svc.db.query.checks.findMany({ where: eq(checksTable.reportId, report.id) })).filter((x) => x.status === 'fail' || x.status === 'review').length : 0;
  const refundOwed = user.walletAddress ? await svc.chain.refundOf(user.walletAddress).catch(() => 0n) : 0n;
  return {
    ...summary,
    stage,
    nextAction: '',
    supplier: { nameEn: supplier?.nameEn ?? '', nameZh: supplier?.nameZh ?? null, uscc: supplier?.uscc ?? null, payoutAddress: (supplier?.payoutAddress as ImporterDeal['supplier']['payoutAddress']) ?? null, confirmed: Boolean(confirmation?.acceptedAt) },
    terms: { cost: onchain?.terms.cost ?? t.cost ?? '0', markup: onchain?.terms.markup ?? t.markup ?? '0', platformFee: onchain?.terms.platform_fee ?? t.platform_fee ?? '0', lateFee: onchain?.terms.late_fee ?? t.late_fee ?? '0', depositBps: onchain?.terms.deposit_bps ?? t.deposit_bps ?? svc.env.SUPPLIER_DEPOSIT_BPS, tenorSecs: onchain?.terms.tenor_secs ?? t.tenor_secs ?? 0, acceptWindowSecs: onchain?.terms.accept_window_secs ?? t.accept_window_secs ?? svc.env.ACCEPT_WINDOW_SECS, fundingDeadline: onchain?.terms.funding_deadline ?? null },
    documents: await documentRecords(svc, deal.id, true),
    reportSummary: report ? { decision: report.decision as ImporterDeal['decision'] & string, riskScore: report.riskScore, explanation: report.explanation, fixCount, createdAt: report.createdAt.toISOString() } : null,
    promise: promise ? { textHash: promise.textHash, listingFingerprint: promise.listingFingerprint, security: promise.security, securityBps: promise.securityBps, txHash: promise.onchainTxHash, signedAt: promise.signedAt?.toISOString() ?? null, withdrawable: Boolean(promise.onchainTxHash) && !deal.onchainId, text: promise.text } : null,
    shipment: shipment ? { carrier: shipment.carrier, blNumber: shipment.blNumber, containers: shipment.containerNumbers, status: shipment.statusCode !== null ? String(shipment.statusCode) : null, documentId: shipment.blDocumentId } : null,
    refundOwed: refundOwed.toString(),
    extension: ext ? { requested: true, reason: ext.reason, decision: ext.status as 'pending' | 'granted' | 'refused', newDueAt: ext.status === 'granted' && onchain ? onchain.due_at : null } : null,
  };
}
