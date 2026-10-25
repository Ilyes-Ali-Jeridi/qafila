/**
 * Purchase promise text (wa'd), versioned. The importer reads this and signs its
 * hash on-chain with `promise_purchase` (FLOWS 9, I-5). Plain words, no jargon.
 */
import { formatAmount, bpsToPercent } from './format.js';

export const PROMISE_TEMPLATE_VERSION = '1.1.0';

export interface PromiseParams {
  importerName: string;
  importerAddress: string;
  entityName: string; // "Qafila Trade"
  dealNumber: number;
  goodsSummary: string;
  supplierName: string;
  cost: bigint;
  markup: bigint;
  security: bigint;
  securityBps: number;
  tenorDays: number;
  acceptWindowDays: number;
  tokenCode: string;
  listingFingerprintHex: string;
}

export function renderPromiseText(p: PromiseParams): string {
  const price = p.cost + p.markup;
  return [
    `Purchase promise, template ${PROMISE_TEMPLATE_VERSION}`,
    ``,
    `I, ${p.importerName} (wallet ${p.importerAddress}), promise to buy from ${p.entityName}, deal ${p.dealNumber}:`,
    `${p.goodsSummary}, supplied by ${p.supplierName}.`,
    ``,
    `1. The price. Once ${p.entityName} owns the goods, I will buy them for ${formatAmount(price, p.tokenCode)}: the cost of ${formatAmount(p.cost, p.tokenCode)} plus a fixed profit of ${formatAmount(p.markup, p.tokenCode)}. The price never changes.`,
    `2. When I sign. I will sign the sale within ${p.acceptWindowDays} days of ${p.entityName} owning the goods. I will pay the price within ${p.tenorDays} days of signing, in one or more payments.`,
    `3. My security deposit. I lock ${formatAmount(p.security, p.tokenCode)} (${bpsToPercent(p.securityBps)} of the cost) with this promise. Nobody may use it while it is held.`,
    `   a. If the deal does not happen and it is not my fault, I get it back in full.`,
    `   b. If I break this promise, only the actual loss is taken from it: the cost minus what the goods are resold for, never lost profit. The rest comes back to me.`,
    `   c. If I buy the goods, it counts as my first payment of the price.`,
    `4. My supplier. I chose ${p.supplierName}. If they take the deposit and never ship, my security deposit covers the actual loss. I never carry loss or damage to the goods at sea or in storage; the owners carry that.`,
    `5. If I pay late. I will also pay a fixed late fee, which goes to charity, never to investors or ${p.entityName}.`,
    `6. If I am in difficulty. I may ask once for more time. The price will not go up.`,
    ``,
    `Deal fingerprint: ${p.listingFingerprintHex}`,
  ].join('\n');
}
