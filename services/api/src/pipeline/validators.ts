/**
 * Deterministic validators (PLAN 5.3). Exact algorithms with the test vectors in
 * test/validators.test.ts. Each function returns `Check` objects for the report.
 */
import type { BillOfLading, Check, Invoice, PackingList } from '@qafila/shared';
import { INCOTERMS_2020 } from '@qafila/shared';
import { daysBetween, isoDate, normaliseContainer, normaliseCurrency, normaliseEnName } from './normalise.js';

// ---------------------------------------------------------------- check digits

/** ISO 6346: letters A=10 skipping multiples of 11, digits as is, weights 2^position, sum mod 11 mod 10. */
export function iso6346CheckDigit(prefix10: string): number | null {
  if (!/^[A-Z]{4}\d{6}$/.test(prefix10)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = prefix10[i]!;
    let v: number;
    if (ch >= '0' && ch <= '9') v = Number(ch);
    else {
      v = ch.charCodeAt(0) - 65 + 10;
      v += Math.floor(v / 11); // skip 11, 22, 33
    }
    sum += v * 2 ** i;
  }
  return (sum % 11) % 10;
}

export function isValidContainerNumber(n: string): boolean {
  const c = normaliseContainer(n);
  if (!/^[A-Z]{4}\d{7}$/.test(c)) return false;
  return iso6346CheckDigit(c.slice(0, 10)) === Number(c[10]);
}

export const USCC_CHARSET = '0123456789ABCDEFGHJKLMNPQRTUWXY';
export const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

/** GB 32100-2015 (ISO 7064 MOD 31-3) check character for the first 17 characters. */
export function usccCheckChar(body17: string): string | null {
  if (body17.length !== 17) return null;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = USCC_CHARSET.indexOf(body17[i]!);
    if (v < 0) return null;
    sum += v * USCC_WEIGHTS[i]!;
  }
  return USCC_CHARSET[(31 - (sum % 31)) % 31]!;
}

export function isValidUscc(code: string): boolean {
  const c = (code ?? '').trim().toUpperCase();
  if (c.length !== 18) return false;
  return usccCheckChar(c.slice(0, 17)) === c[17];
}

// ---------------------------------------------------------------- checks

const W = { critical: 40, high: 25, medium: 15, low: 8, info: 3 } as const;

export function checkContainers(numbers: Array<{ value: string | null; document: string }>): Check[] {
  const seen = numbers.filter((n) => n.value);
  if (seen.length === 0) return [{ name: 'validators.container_check_digit', status: 'skipped', severity: 'info', detail: 'No container numbers on the documents at this stage.', weight: 0 }];
  const bad = seen.filter((n) => !isValidContainerNumber(n.value!));
  if (bad.length === 0) return [{ name: 'validators.container_check_digit', status: 'pass', severity: 'critical', detail: `${seen.length} container number(s) pass the ISO 6346 check digit.`, weight: W.critical, evidence: seen.map((n) => n.value) }];
  return [
    {
      name: 'validators.container_check_digit',
      status: 'fail',
      severity: 'critical',
      detail: `Container number ${bad.map((b) => b.value).join(', ')} fails the ISO 6346 check digit.`,
      weight: W.critical,
      evidence: bad.map((b) => ({ value: b.value, document: b.document, expected_check_digit: iso6346CheckDigit(normaliseContainer(b.value!).slice(0, 10)) })),
      document: bad[0]!.document,
      field: 'container_number',
      fix: 'Ask the supplier or carrier for the correct container number; a typo of one character changes the check digit.',
    },
  ];
}

export function checkUscc(code: string | null, document: string): Check {
  if (!code) return { name: 'validators.uscc_check_digit', status: 'review', severity: 'high', detail: 'No Unified Social Credit Code found on the business licence.', weight: W.high, document, field: 'uscc', fix: 'Upload a business licence that shows the 18-character Unified Social Credit Code.' };
  if (isValidUscc(code)) return { name: 'validators.uscc_check_digit', status: 'pass', severity: 'critical', detail: `Unified Social Credit Code ${code} passes the GB 32100 check character.`, weight: W.critical, document, field: 'uscc' };
  return { name: 'validators.uscc_check_digit', status: 'fail', severity: 'critical', detail: `Unified Social Credit Code ${code} fails the GB 32100 check character.`, weight: W.critical, document, field: 'uscc', evidence: { code, expected_check_char: code.length === 18 ? usccCheckChar(code.slice(0, 17).toUpperCase()) : null }, fix: 'Check the code on the licence against gsxt.gov.cn; the code printed does not validate.' };
}

export interface ArithmeticResult {
  checks: Check[];
  maxLineErrorPct: number | null;
  totalErrorPct: number | null;
  smallMismatch: boolean;
}

/** Each line qty x unit_price = line_total within 0.01; sum of lines = total within 0.01; off by more than 1% is a reject (5.6). */
export function checkArithmetic(inv: Invoice): ArithmeticResult {
  const lines = inv.line_items;
  const lineErrors: Array<{ line: number; expected: number; printed: number; pct: number }> = [];
  let sum = 0;
  let missing = 0;
  for (const [i, l] of lines.entries()) {
    const q = l.quantity.value;
    const p = l.unit_price.value;
    const t = l.line_total.value;
    if (q === null || p === null || t === null) {
      missing++;
      continue;
    }
    const expected = Math.round(q * p * 100) / 100;
    sum += t;
    const diff = Math.abs(expected - t);
    if (diff > 0.01) lineErrors.push({ line: i + 1, expected, printed: t, pct: expected === 0 ? 100 : (diff / expected) * 100 });
  }
  const total = inv.total.value;
  const sumRounded = Math.round(sum * 100) / 100;
  const totalDiff = total === null ? null : Math.abs(sumRounded - total);
  const totalPct = total === null || total === 0 ? null : (totalDiff! / total) * 100;
  const maxLinePct = lineErrors.length ? Math.max(...lineErrors.map((e) => e.pct)) : 0;
  const currencyOk = normaliseCurrency(inv.currency.value) !== null;
  const checks: Check[] = [];
  const evidence = { line_errors: lineErrors, sum_of_lines: sumRounded, printed_total: total, missing_lines: missing };
  const worst = Math.max(maxLinePct, totalPct ?? 0);
  if (total === null || missing === lines.length) {
    checks.push({ name: 'validators.arithmetic', status: 'review', severity: 'high', detail: 'The invoice total or the line amounts could not be read.', weight: W.high, evidence, document: 'invoice', field: 'total', fix: 'Upload a clearer invoice showing every line amount and the total.' });
  } else if (worst > 1) {
    checks.push({ name: 'validators.arithmetic', status: 'fail', severity: 'critical', detail: `Invoice arithmetic is off by ${worst.toFixed(1)}%: the line amounts add up to ${sumRounded.toFixed(2)} but the printed total is ${total.toFixed(2)}${lineErrors.length ? `; ${lineErrors.length} line amount(s) do not equal quantity x unit price` : ''}.`, weight: W.critical, evidence, document: 'invoice', field: 'total', fix: 'Ask the supplier for a corrected invoice whose line amounts add up to the total.' });
  } else if (lineErrors.length > 0 || (totalDiff !== null && totalDiff > 0.01)) {
    checks.push({ name: 'validators.arithmetic', status: 'review', severity: 'medium', detail: `Invoice arithmetic differs by ${worst.toFixed(2)}% (rounding or a small error).`, weight: W.medium, evidence, document: 'invoice', field: 'total', fix: 'Confirm the rounding with the supplier or upload a corrected invoice.' });
  } else {
    checks.push({ name: 'validators.arithmetic', status: 'pass', severity: 'critical', detail: `${lines.length} line amounts equal quantity x unit price and add up to the printed total ${total.toFixed(2)} ${normaliseCurrency(inv.currency.value) ?? ''}.`, weight: W.critical, evidence });
  }
  if (!currencyOk) checks.push({ name: 'validators.currency', status: 'review', severity: 'medium', detail: 'Invoice currency is missing or not an ISO code.', weight: W.medium, document: 'invoice', field: 'currency', fix: 'The invoice must state its currency (USD, CNY, EUR).' });
  return { checks, maxLineErrorPct: lineErrors.length ? maxLinePct : 0, totalErrorPct: totalPct, smallMismatch: worst > 0 && worst <= 1 };
}

/** Invoice date <= B/L shipped date <= today; shipped within 60 days of the invoice; no future dates. */
export function checkDates(inv: Invoice | null, pl: PackingList | null, bl: BillOfLading | null, today = new Date().toISOString().slice(0, 10)): Check {
  const problems: string[] = [];
  const invDate = isoDate(inv?.invoice_date.value);
  const plDate = isoDate(pl?.date.value);
  const shipped = isoDate(bl?.shipped_on_board_date.value);
  const issued = isoDate(bl?.issue_date.value);
  for (const [label, d] of [['invoice date', invDate], ['packing list date', plDate], ['shipped on board date', shipped], ['B/L issue date', issued]] as const) {
    if (d && d > today) problems.push(`${label} ${d} is in the future`);
  }
  if (inv && !invDate) problems.push('invoice date missing or unreadable');
  if (invDate && plDate && plDate < invDate) problems.push(`packing list date ${plDate} is before the invoice date ${invDate}`);
  if (invDate && shipped) {
    if (shipped < invDate) problems.push(`shipped on board ${shipped} is before the invoice date ${invDate}`);
    else if (daysBetween(invDate, shipped) > 60) problems.push(`shipped on board ${shipped} is more than 60 days after the invoice date ${invDate}`);
  }
  if (bl && !shipped) problems.push('shipped on board date missing on the B/L');
  if (problems.length) return { name: 'validators.dates', status: 'review', severity: 'medium', detail: problems.join('; ') + '.', weight: W.medium, evidence: { invDate, plDate, shipped, issued, today }, fix: 'Check the dates on the documents; the sequence must be invoice, then shipment within 60 days, and no date may be in the future.' };
  return { name: 'validators.dates', status: 'pass', severity: 'medium', detail: `Dates are in order (invoice ${invDate ?? 'n/a'}${shipped ? `, shipped ${shipped}` : ''}).`, weight: W.medium, evidence: { invDate, plDate, shipped, issued, today } };
}

export interface WeightResult {
  check: Check;
  mismatchPct: number | null;
}

/** Packing list gross vs B/L gross: within 2% pass, 2 to 5% review, above 5% reject. */
export function checkWeights(pl: PackingList | null, bl: BillOfLading | null): WeightResult {
  const a = pl?.total_gross_weight_kg.value ?? null;
  const b = bl?.gross_weight_kg.value ?? null;
  if (a === null || b === null) {
    return { check: { name: 'validators.weights', status: bl ? 'review' : 'skipped', severity: 'medium', detail: bl ? 'Gross weight is missing on the packing list or the B/L.' : 'No bill of lading at this stage.', weight: bl ? W.medium : 0, document: 'bill_of_lading', field: 'gross_weight_kg' }, mismatchPct: null };
  }
  const pct = a === 0 ? 100 : (Math.abs(a - b) / a) * 100;
  const evidence = { packing_list_gross_kg: a, bl_gross_kg: b, difference_pct: Number(pct.toFixed(2)) };
  if (pct <= 2) return { check: { name: 'validators.weights', status: 'pass', severity: 'high', detail: `Gross weight differs by ${pct.toFixed(1)}% between the packing list (${a} kg) and the B/L (${b} kg).`, weight: W.high, evidence }, mismatchPct: pct };
  if (pct <= 5) return { check: { name: 'validators.weights', status: 'review', severity: 'high', detail: `Gross weight differs by ${pct.toFixed(1)}% between the packing list (${a} kg) and the B/L (${b} kg).`, weight: W.high, evidence, document: 'bill_of_lading', field: 'gross_weight_kg', fix: 'Explain the weight difference (pallets, packaging) or upload a corrected packing list.' }, mismatchPct: pct };
  return { check: { name: 'validators.weights', status: 'fail', severity: 'critical', detail: `Gross weight differs by ${pct.toFixed(1)}% between the packing list (${a} kg) and the B/L (${b} kg).`, weight: W.critical, evidence, document: 'bill_of_lading', field: 'gross_weight_kg', fix: 'The shipped weight does not match the packed weight; the shipment cannot be confirmed as is.' }, mismatchPct: pct };
}

/** Quantities per item equal between invoice and packing list (matched by order, then by description tokens). */
export function checkQuantities(inv: Invoice | null, pl: PackingList | null): Check {
  if (!inv || !pl) return { name: 'validators.quantities', status: 'skipped', severity: 'medium', detail: 'Invoice or packing list missing.', weight: 0 };
  const invQ = inv.line_items.map((l) => l.quantity.value);
  const plQ = pl.items.map((l) => l.quantity.value);
  const mismatches: string[] = [];
  if (invQ.length !== plQ.length) mismatches.push(`${invQ.length} invoice lines vs ${plQ.length} packing list lines`);
  const n = Math.min(invQ.length, plQ.length);
  for (let i = 0; i < n; i++) {
    const a = invQ[i];
    const b = plQ[i];
    if (a === null || b === null || a === undefined || b === undefined) continue;
    if (Math.abs(a - b) > 0.0001) mismatches.push(`line ${i + 1}: invoice ${a} vs packing list ${b}`);
  }
  const evidence = { invoice: invQ, packing_list: plQ };
  if (mismatches.length) return { name: 'validators.quantities', status: 'review', severity: 'high', detail: `Quantities differ: ${mismatches.join('; ')}.`, weight: W.high, evidence, document: 'packing_list', field: 'items', fix: 'The packed quantities must equal the invoiced quantities line by line.' };
  return { name: 'validators.quantities', status: 'pass', severity: 'high', detail: `Quantities match on ${n} line(s) between the invoice and the packing list.`, weight: W.high, evidence };
}

/** Incoterms 2020; HS codes 6 to 10 digits; UN/LOCODE 5 characters when present. */
export function checkFormats(inv: Invoice | null, formIncoterms?: string): Check {
  const problems: string[] = [];
  const term = (inv?.incoterms.value ?? formIncoterms ?? '').toUpperCase().trim().slice(0, 3);
  if (!term) problems.push('Incoterms missing');
  else if (!(INCOTERMS_2020 as readonly string[]).includes(term)) problems.push(`Incoterm "${term}" is not in the Incoterms 2020 list`);
  for (const [i, l] of (inv?.line_items ?? []).entries()) {
    const hs = (l.hs_code.value ?? '').replace(/\D/g, '');
    if (l.hs_code.value && (hs.length < 6 || hs.length > 10)) problems.push(`line ${i + 1} HS code "${l.hs_code.value}" is not 6 to 10 digits`);
  }
  for (const [label, v] of [['port of loading', inv?.port_of_loading.value], ['port of discharge', inv?.port_of_discharge.value]] as const) {
    const m = /\(([A-Z0-9]{2,6})\)/.exec(v ?? '');
    if (m && m[1]!.length !== 5) problems.push(`${label} code "${m[1]}" is not a 5-character UN/LOCODE`);
  }
  if (problems.length) return { name: 'validators.formats', status: 'review', severity: 'low', detail: problems.join('; ') + '.', weight: W.low, document: 'invoice', fix: 'Use an Incoterms 2020 term, 6 to 10 digit HS codes and 5-character UN/LOCODEs.' };
  return { name: 'validators.formats', status: 'pass', severity: 'low', detail: `Incoterm ${term} is valid; HS codes and port codes are well formed.`, weight: W.low };
}

/** Deterministic buyer check (FLOWS 9): the invoice buyer must be Qafila's deal entity. */
export function checkBuyer(inv: Invoice | null, entityName: string, dealNumber: number): Check {
  const buyer = inv?.buyer.name_en.value ?? '';
  const n = normaliseEnName(buyer);
  const entity = normaliseEnName(entityName);
  if (!buyer) return { name: 'structure.buyer', status: 'review', severity: 'high', detail: 'The invoice names no buyer.', weight: W.high, document: 'invoice', field: 'buyer', fix: `The invoice must be made out to "${entityName}, deal ${dealNumber}".` };
  if (!n.includes(entity)) return { name: 'structure.buyer', status: 'review', severity: 'high', detail: `The invoice buyer is "${buyer}", not ${entityName}'s deal entity.`, weight: W.high, document: 'invoice', field: 'buyer', evidence: buyer, fix: `Ask the supplier to re-issue the invoice to "${entityName}, deal ${dealNumber}".` };
  const dealMatch = /deal\s*(?:no\.?\s*)?#?(\d+)/i.exec(buyer);
  if (dealMatch && Number(dealMatch[1]) !== dealNumber) return { name: 'structure.buyer', status: 'pass', severity: 'low', detail: `The invoice buyer refers to deal ${dealMatch[1]} but this is deal ${dealNumber}.`, weight: W.low, document: 'invoice', field: 'buyer', evidence: buyer, fix: `The invoice must reference deal ${dealNumber}.` };
  return { name: 'structure.buyer', status: 'pass', severity: 'high', detail: `The invoice is made out to ${entityName}'s deal entity ("${buyer}").`, weight: W.high, evidence: buyer };
}

/** B/L consignee must be "to order of" Qafila's deal entity and the notify party the importer (FLOWS 9). */
export function checkConsignee(bl: BillOfLading | null, entityName: string, dealNumber: number, importerName: string): Check[] {
  if (!bl) return [];
  const consignee = bl.consignee.value ?? '';
  const toOrder = bl.consignee_to_order.value === true || /to\s+(the\s+)?order/i.test(consignee);
  const entity = normaliseEnName(entityName);
  const out: Check[] = [];
  if (!consignee) out.push({ name: 'structure.consignee', status: 'review', severity: 'high', detail: 'The B/L consignee box is empty or unreadable.', weight: W.high, document: 'bill_of_lading', field: 'consignee', fix: `The B/L must be consigned "to order of ${entityName}, deal ${dealNumber}".` });
  else if (!normaliseEnName(consignee).includes(entity)) out.push({ name: 'structure.consignee', status: 'review', severity: 'high', detail: `The B/L consignee is "${consignee}", not ${entityName}'s deal entity, so ${entityName} does not own the goods under this B/L.`, weight: W.high, document: 'bill_of_lading', field: 'consignee', evidence: consignee, fix: `Ask the carrier to amend the B/L: consignee "to order of ${entityName}, deal ${dealNumber}", notify party the importer.` });
  else if (!toOrder) out.push({ name: 'structure.consignee', status: 'review', severity: 'medium', detail: `The B/L names ${entityName} as consignee but is not made out "to order".`, weight: W.medium, document: 'bill_of_lading', field: 'consignee', evidence: consignee, fix: `The B/L should read "to order of ${entityName}, deal ${dealNumber}".` });
  else out.push({ name: 'structure.consignee', status: 'pass', severity: 'high', detail: `The B/L is made out to order of ${entityName}'s deal entity ("${consignee}").`, weight: W.high, evidence: consignee });
  const notify = bl.notify_party.value ?? '';
  const importerCore = normaliseEnName(importerName).split(' ').filter((w) => w.length > 2);
  const notifyNorm = normaliseEnName(notify);
  const overlap = importerCore.filter((w) => notifyNorm.includes(w)).length;
  if (!notify) out.push({ name: 'structure.notify_party', status: 'review', severity: 'medium', detail: 'The B/L has no notify party.', weight: W.medium, document: 'bill_of_lading', field: 'notify_party', fix: `The notify party must be the importer, ${importerName}.` });
  else if (overlap < Math.max(1, Math.ceil(importerCore.length / 2))) out.push({ name: 'structure.notify_party', status: 'review', severity: 'medium', detail: `The B/L notify party is "${notify}", not the importer ${importerName}.`, weight: W.medium, document: 'bill_of_lading', field: 'notify_party', evidence: notify, fix: `The notify party must be the importer, ${importerName}.` });
  else out.push({ name: 'structure.notify_party', status: 'pass', severity: 'medium', detail: `The notify party is the importer ("${notify}").`, weight: W.medium, evidence: notify });
  return out;
}

export const WEIGHTS = W;
