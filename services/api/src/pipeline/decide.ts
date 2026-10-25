/**
 * Decision policy (PLAN 5.6, FLOWS 9): a pure function over structured facts. The LLM
 * never decides; it only contributes judgments that appear here as facts. Reject rules
 * win over review rules; approve otherwise.
 */
import type { Decision } from '@qafila/shared';

export interface DecisionFacts {
  stage: 'listing' | 'shipment';
  containerCheckDigitsValid: boolean | null; // null = no containers on the documents
  usccCheckDigitValid: boolean | null; // null = no code
  registry: { available: boolean; found: boolean; entityStatus: string | null; leiStatus: string | null; nameMatch: 'yes' | 'no' | 'unsure' | 'n/a'; source?: string; opsOverride: boolean };
  maxSanctionsScore: number;
  sanctionsAvailable: boolean;
  halalVerdicts: Array<'permitted' | 'prohibited' | 'review'>;
  listingFingerprintUsed: boolean;
  shipmentFingerprintUsed: boolean;
  arithmeticOffPct: number | null; // worst relative error in percent, null when not computable
  weightMismatchPct: number | null;
  priceRatios: Array<number | null>;
  consistency: Array<'yes' | 'no' | 'unsure'>;
  tracking: { available: boolean; containerPresent: boolean; loadingVesselMatch: 'yes' | 'no' | 'unsure' | 'n/a'; statusLoaded: boolean } | null;
  minKeyFieldConfidence: number;
  missingKeyFields: number;
  extractionFailed: boolean;
  dealStructureOk: boolean; // buyer / consignee / notify party
  datesOk: boolean;
  quantitiesMatch: boolean | null;
  thresholds?: { priceRatioLow: number; priceRatioHigh: number; sanctionsReview: number; sanctionsReject: number; weightReviewPct: number; weightRejectPct: number; keyFieldMinConfidence: number };
}

export interface DecisionReason {
  rule: string;
  level: 'reject' | 'review';
  detail: string;
}

export interface DecisionOutput {
  decision: Decision;
  reasons: DecisionReason[];
}

const DEFAULT_T = { priceRatioLow: 0.5, priceRatioHigh: 2, sanctionsReview: 0.7, sanctionsReject: 0.9, weightReviewPct: 2, weightRejectPct: 5, keyFieldMinConfidence: 0.8 };
const INACTIVE = /^(INACTIVE|CLOSED|REVOKED|DEREGISTERED|CANCELLED|DISSOLVED)$/i;

export function decide(f: DecisionFacts): DecisionOutput {
  const t = f.thresholds ?? DEFAULT_T;
  const reasons: DecisionReason[] = [];
  const reject = (rule: string, detail: string) => reasons.push({ rule, level: 'reject', detail });
  const review = (rule: string, detail: string) => reasons.push({ rule, level: 'review', detail });

  // Reject rules (5.6)
  if (f.containerCheckDigitsValid === false) reject('container_check_digit', 'A container number fails its check digit.');
  if (f.usccCheckDigitValid === false) reject('uscc_check_digit', 'The supplier company code fails its check character.');
  if (f.registry.available && f.registry.found && f.registry.entityStatus && INACTIVE.test(f.registry.entityStatus)) reject('registry_inactive', `Registry status is ${f.registry.entityStatus}.`);
  if (f.maxSanctionsScore >= t.sanctionsReject) reject('sanctions_match', `A sanctions match scores ${f.maxSanctionsScore.toFixed(2)}.`);
  if (f.halalVerdicts.includes('prohibited')) reject('halal_prohibited', 'A line item is prohibited by the halal policy.');
  if (f.listingFingerprintUsed) reject('duplicate_invoice', 'The invoice fingerprint was already financed.');
  if (f.arithmeticOffPct !== null && f.arithmeticOffPct > 1) reject('arithmetic', `Invoice arithmetic is off by ${f.arithmeticOffPct.toFixed(1)}%.`);
  if (f.stage === 'shipment' && f.tracking?.available) {
    if (f.tracking.loadingVesselMatch === 'no') reject('loading_vessel_mismatch', "The carrier's loading event names a different vessel than the B/L.");
    if (!f.tracking.containerPresent) reject('container_not_at_port', 'The B/L container never appears in carrier tracking.');
  }
  if (f.stage === 'shipment' && f.shipmentFingerprintUsed) reject('duplicate_bl', 'The B/L fingerprint was already used.');
  if (f.weightMismatchPct !== null && f.weightMismatchPct > t.weightRejectPct) reject('weight_mismatch', `Weights differ by ${f.weightMismatchPct.toFixed(1)}%.`);

  // Review rules (5.6, FLOWS 9)
  for (const r of f.priceRatios) if (r !== null && (r < t.priceRatioLow || r > t.priceRatioHigh)) review('price_out_of_range', `A unit price is ${r.toFixed(2)}x the reference midpoint.`);
  if (f.weightMismatchPct !== null && f.weightMismatchPct > t.weightReviewPct && f.weightMismatchPct <= t.weightRejectPct) review('weight_mismatch_small', `Weights differ by ${f.weightMismatchPct.toFixed(1)}%.`);
  if (f.consistency.includes('unsure')) review('consistency_unsure', 'A consistency judgment is unsure.');
  if (f.consistency.includes('no')) review('consistency_mismatch', 'Two documents disagree on a field.');
  if (!f.registry.available && !f.registry.opsOverride) review('registry_unavailable', 'The company registry was not available.');
  if (f.stage === 'shipment' && f.tracking && !f.tracking.available) review('tracking_unavailable', 'Carrier tracking was not available.');
  if (f.registry.available && !f.registry.opsOverride) {
    if (!f.registry.found) review('registry_not_found', 'The supplier was not found in the registry.');
    else {
      if (f.registry.entityStatus && !INACTIVE.test(f.registry.entityStatus) && f.registry.entityStatus.toUpperCase() !== 'ACTIVE') review('registry_status_unclear', `Registry status is ${f.registry.entityStatus}.`);
      if (f.registry.leiStatus && f.registry.leiStatus.toUpperCase() !== 'ISSUED' && f.registry.source === 'gleif') review('lei_lapsed', `LEI status is ${f.registry.leiStatus}.`);
      if (f.registry.nameMatch === 'no' || f.registry.nameMatch === 'unsure') review('registry_name_mismatch', 'The legal name does not match the registry record.');
    }
  }
  if (!f.sanctionsAvailable) review('sanctions_unavailable', 'Sanctions screening was not available.');
  if (f.maxSanctionsScore >= t.sanctionsReview && f.maxSanctionsScore < t.sanctionsReject) review('sanctions_possible', `A possible sanctions match scores ${f.maxSanctionsScore.toFixed(2)}.`);
  if (f.extractionFailed) review('extraction_failed', 'A document could not be read.');
  if (f.missingKeyFields > 0 || f.minKeyFieldConfidence < t.keyFieldMinConfidence) review('low_confidence', 'A key field is missing or below 0.8 confidence.');
  if (f.halalVerdicts.includes('review')) review('halal_review', 'A line item needs a halal review.');
  if (f.arithmeticOffPct !== null && f.arithmeticOffPct > 0 && f.arithmeticOffPct <= 1) review('arithmetic_small', 'Invoice arithmetic differs by up to 1%.');
  if (f.arithmeticOffPct === null && f.stage === 'listing' && !f.extractionFailed) review('arithmetic_unavailable', 'Invoice arithmetic could not be checked.');
  if (!f.dealStructureOk) review('deal_structure', f.stage === 'shipment' ? 'The B/L is not made out to order of Qafila with the importer as notify party.' : "The invoice buyer is not Qafila's deal entity.");
  if (!f.datesOk) review('dates', 'Document dates are out of sequence or in the future.');
  if (f.quantitiesMatch === false) review('quantities', 'Quantities differ between the invoice and the packing list.');
  if (f.stage === 'shipment' && f.tracking?.available) {
    if (f.tracking.loadingVesselMatch === 'unsure' || f.tracking.loadingVesselMatch === 'n/a') review('loading_vessel_unsure', 'The loading vessel could not be matched with confidence.');
    if (!f.tracking.statusLoaded) review('not_loaded', 'The carrier has not reported the container loaded.');
  }

  const decision: Decision = reasons.some((r) => r.level === 'reject') ? 'reject' : reasons.length ? 'review' : 'approve';
  return { decision, reasons };
}
