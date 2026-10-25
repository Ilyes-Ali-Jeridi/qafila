/**
 * Fingerprints (PLAN 5.2): listing = sha256 of canonical JSON of supplier company code
 * (or normalised name), invoice number, invoice date, total and currency; shipment =
 * carrier, B/L number and sorted container numbers. Checked in the database here and
 * on-chain in list_deal / confirm_shipment, so one invoice or B/L never backs two deals.
 */
import { listingFingerprint, shipmentFingerprint, toHex } from '@qafila/shared/attestation';
import type { BillOfLading, Check, Invoice } from '@qafila/shared';
import { normaliseContainer, normaliseCurrency, normaliseEnName, normaliseZhName } from './normalise.js';
import type { DealContext, FingerprintStore } from './types.js';
import { WEIGHTS } from './validators.js';

export function computeListingFingerprint(inv: Invoice, ctx: DealContext): { hex: string; parts: Record<string, string> } | null {
  const supplierKey = (inv.seller.uscc.value ?? ctx.supplier.uscc ?? '').toUpperCase().trim() || normaliseZhName(inv.seller.name_zh.value) || normaliseEnName(inv.seller.name_en.value ?? ctx.supplier.nameEn);
  const invoiceNumber = inv.invoice_number.value;
  const invoiceDate = inv.invoice_date.value;
  const total = inv.total.value;
  const currency = normaliseCurrency(inv.currency.value);
  if (!supplierKey || !invoiceNumber || !invoiceDate || total === null || !currency) return null;
  const parts = { supplier: supplierKey, invoice_number: invoiceNumber, invoice_date: invoiceDate, total: total.toFixed(2), currency };
  return { hex: toHex(listingFingerprint({ supplierKey, invoiceNumber, invoiceDate, total: parts.total, currency })), parts };
}

export function computeShipmentFingerprint(bl: BillOfLading, ctx: DealContext): { hex: string; parts: Record<string, unknown> } | null {
  const carrier = (bl.scac.value ?? bl.carrier.value ?? ctx.carrier ?? '').trim();
  const blNumber = bl.bl_number.value ?? ctx.blNumber ?? null;
  const containers = bl.containers.map((c) => normaliseContainer(c.number.value)).filter(Boolean);
  if (!carrier || !blNumber || containers.length === 0) return null;
  return { hex: toHex(shipmentFingerprint({ carrier, blNumber, containers })), parts: { carrier, bl_number: blNumber, containers: [...new Set(containers)].sort() } };
}

export async function listingFingerprintCheck(inv: Invoice | null, ctx: DealContext, store: FingerprintStore): Promise<{ hex: string | null; used: boolean; check: Check }> {
  const fp = inv ? computeListingFingerprint(inv, ctx) : null;
  if (!fp) return { hex: null, used: false, check: { name: 'fingerprint.listing', status: 'review', severity: 'high', detail: 'The listing fingerprint could not be computed (supplier code, invoice number, date, total or currency missing).', weight: WEIGHTS.high, document: 'invoice', fix: 'The invoice must show its number, date, total and currency.' } };
  const usedBy = await store.hasListing(fp.hex);
  if (usedBy && usedBy !== ctx.dealRef) return { hex: fp.hex, used: true, check: { name: 'fingerprint.listing', status: 'fail', severity: 'critical', detail: `This invoice (${fp.parts['invoice_number']} of ${fp.parts['invoice_date']}, ${fp.parts['total']} ${fp.parts['currency']}) was already financed (deal ${usedBy}).`, weight: WEIGHTS.critical, evidence: { fingerprint: fp.hex, parts: fp.parts, used_by: usedBy }, document: 'invoice', fix: 'The same invoice cannot be financed twice. The account goes under review.' } };
  return { hex: fp.hex, used: false, check: { name: 'fingerprint.listing', status: 'pass', severity: 'critical', detail: 'This invoice has not been financed before.', weight: WEIGHTS.critical, evidence: { fingerprint: fp.hex, parts: fp.parts } } };
}

export async function shipmentFingerprintCheck(bl: BillOfLading | null, ctx: DealContext, store: FingerprintStore): Promise<{ hex: string | null; used: boolean; check: Check }> {
  const fp = bl ? computeShipmentFingerprint(bl, ctx) : null;
  if (!fp) return { hex: null, used: false, check: { name: 'fingerprint.shipment', status: 'review', severity: 'high', detail: 'The shipment fingerprint could not be computed (carrier, B/L number or containers missing).', weight: WEIGHTS.high, document: 'bill_of_lading' } };
  const usedBy = await store.hasShipment(fp.hex);
  if (usedBy && usedBy !== ctx.dealRef) return { hex: fp.hex, used: true, check: { name: 'fingerprint.shipment', status: 'fail', severity: 'critical', detail: `This bill of lading (${String(fp.parts['bl_number'])}) already backs deal ${usedBy}.`, weight: WEIGHTS.critical, evidence: { fingerprint: fp.hex, parts: fp.parts, used_by: usedBy }, document: 'bill_of_lading', fix: 'One B/L can back only one deal.' } };
  return { hex: fp.hex, used: false, check: { name: 'fingerprint.shipment', status: 'pass', severity: 'critical', detail: 'This bill of lading has not backed another deal.', weight: WEIGHTS.critical, evidence: { fingerprint: fp.hex, parts: fp.parts } } };
}
