import { describe, expect, it } from 'vitest';
import { decide, type DecisionFacts } from '../src/pipeline/decide.js';

const clean = (over: Partial<DecisionFacts> = {}): DecisionFacts => ({
  stage: 'listing',
  containerCheckDigitsValid: true,
  usccCheckDigitValid: true,
  registry: { available: true, found: true, entityStatus: 'ACTIVE', leiStatus: 'ISSUED', nameMatch: 'yes', source: 'gleif', opsOverride: false },
  maxSanctionsScore: 0,
  sanctionsAvailable: true,
  halalVerdicts: ['permitted', 'permitted'],
  listingFingerprintUsed: false,
  shipmentFingerprintUsed: false,
  arithmeticOffPct: 0,
  weightMismatchPct: null,
  priceRatios: [1, 0.8],
  consistency: ['yes', 'yes'],
  tracking: null,
  minKeyFieldConfidence: 0.95,
  missingKeyFields: 0,
  extractionFailed: false,
  dealStructureOk: true,
  datesOk: true,
  quantitiesMatch: true,
  ...over,
});

const table: Array<[string, Partial<DecisionFacts>, 'approve' | 'review' | 'reject', string]> = [
  ['clean listing', {}, 'approve', ''],
  ['container check digit', { containerCheckDigitsValid: false }, 'reject', 'container_check_digit'],
  ['uscc check digit', { usccCheckDigitValid: false }, 'reject', 'uscc_check_digit'],
  ['registry inactive', { registry: { available: true, found: true, entityStatus: 'INACTIVE', leiStatus: 'RETIRED', nameMatch: 'yes', source: 'fixture', opsOverride: false } }, 'reject', 'registry_inactive'],
  ['registry deregistered', { registry: { available: true, found: true, entityStatus: 'DEREGISTERED', leiStatus: null, nameMatch: 'yes', source: 'qcc', opsOverride: false } }, 'reject', 'registry_inactive'],
  ['sanctions 0.9', { maxSanctionsScore: 0.9 }, 'reject', 'sanctions_match'],
  ['sanctions 0.75', { maxSanctionsScore: 0.75 }, 'review', 'sanctions_possible'],
  ['sanctions 0.69', { maxSanctionsScore: 0.69 }, 'approve', ''],
  ['halal prohibited', { halalVerdicts: ['permitted', 'prohibited'] }, 'reject', 'halal_prohibited'],
  ['halal review', { halalVerdicts: ['review'] }, 'review', 'halal_review'],
  ['duplicate invoice', { listingFingerprintUsed: true }, 'reject', 'duplicate_invoice'],
  ['arithmetic 8.6%', { arithmeticOffPct: 8.6 }, 'reject', 'arithmetic'],
  ['arithmetic 0.5%', { arithmeticOffPct: 0.5 }, 'review', 'arithmetic_small'],
  ['price 4x', { priceRatios: [4.17, 1] }, 'review', 'price_out_of_range'],
  ['price 0.4x', { priceRatios: [0.4] }, 'review', 'price_out_of_range'],
  ['price 1.9x', { priceRatios: [1.9] }, 'approve', ''],
  ['consistency unsure', { consistency: ['yes', 'unsure'] }, 'review', 'consistency_unsure'],
  ['registry unavailable', { registry: { available: false, found: false, entityStatus: null, leiStatus: null, nameMatch: 'n/a', opsOverride: false } }, 'review', 'registry_unavailable'],
  ['registry unavailable with ops override', { registry: { available: false, found: false, entityStatus: null, leiStatus: null, nameMatch: 'n/a', opsOverride: true } }, 'approve', ''],
  ['registry not found', { registry: { available: true, found: false, entityStatus: null, leiStatus: null, nameMatch: 'n/a', source: 'gleif', opsOverride: false } }, 'review', 'registry_not_found'],
  ['lei lapsed', { registry: { available: true, found: true, entityStatus: 'ACTIVE', leiStatus: 'LAPSED', nameMatch: 'yes', source: 'gleif', opsOverride: false } }, 'review', 'lei_lapsed'],
  ['name mismatch', { registry: { available: true, found: true, entityStatus: 'ACTIVE', leiStatus: 'ISSUED', nameMatch: 'no', source: 'gleif', opsOverride: false } }, 'review', 'registry_name_mismatch'],
  ['low confidence', { minKeyFieldConfidence: 0.6 }, 'review', 'low_confidence'],
  ['missing key field', { missingKeyFields: 1 }, 'review', 'low_confidence'],
  ['buyer not Qafila', { dealStructureOk: false }, 'review', 'deal_structure'],
  ['dates wrong', { datesOk: false }, 'review', 'dates'],
  ['quantities differ', { quantitiesMatch: false }, 'review', 'quantities'],
  ['weights 1.5% at shipment', { stage: 'shipment', weightMismatchPct: 1.5, tracking: { available: true, containerPresent: true, loadingVesselMatch: 'yes', statusLoaded: true }, quantitiesMatch: null }, 'approve', ''],
  ['weights 3% at shipment', { stage: 'shipment', weightMismatchPct: 3, tracking: { available: true, containerPresent: true, loadingVesselMatch: 'yes', statusLoaded: true }, quantitiesMatch: null }, 'review', 'weight_mismatch_small'],
  ['weights 6% at shipment', { stage: 'shipment', weightMismatchPct: 6, tracking: { available: true, containerPresent: true, loadingVesselMatch: 'yes', statusLoaded: true }, quantitiesMatch: null }, 'reject', 'weight_mismatch'],
  ['loading vessel differs', { stage: 'shipment', tracking: { available: true, containerPresent: true, loadingVesselMatch: 'no', statusLoaded: true }, quantitiesMatch: null }, 'reject', 'loading_vessel_mismatch'],
  ['container never at port', { stage: 'shipment', tracking: { available: true, containerPresent: false, loadingVesselMatch: 'n/a', statusLoaded: true }, quantitiesMatch: null }, 'reject', 'container_not_at_port'],
  ['tracking unavailable', { stage: 'shipment', tracking: { available: false, containerPresent: false, loadingVesselMatch: 'n/a', statusLoaded: false }, quantitiesMatch: null }, 'review', 'tracking_unavailable'],
  ['duplicate B/L', { stage: 'shipment', shipmentFingerprintUsed: true, tracking: { available: true, containerPresent: true, loadingVesselMatch: 'yes', statusLoaded: true }, quantitiesMatch: null }, 'reject', 'duplicate_bl'],
  ['not loaded yet', { stage: 'shipment', tracking: { available: true, containerPresent: true, loadingVesselMatch: 'yes', statusLoaded: false }, quantitiesMatch: null }, 'review', 'not_loaded'],
  ['reject wins over review', { containerCheckDigitsValid: false, priceRatios: [5] }, 'reject', 'container_check_digit'],
  ['sanctions unavailable', { sanctionsAvailable: false }, 'review', 'sanctions_unavailable'],
];

describe('decision policy (PLAN 5.6) table', () => {
  for (const [name, over, expected, rule] of table) {
    it(`${name} -> ${expected}${rule ? ` (${rule})` : ''}`, () => {
      const out = decide(clean(over));
      expect(out.decision).toBe(expected);
      if (rule) expect(out.reasons.map((r) => r.rule)).toContain(rule);
      else expect(out.reasons).toHaveLength(0);
    });
  }
});
