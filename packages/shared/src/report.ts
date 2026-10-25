/** Verification and shipment report schemas (PLAN 5.2 Report, 6 Job 2). */
import { z } from 'zod';
import { DecisionSchema, Hex32, Hex64, TrackingSnapshotSchema } from './schemas';
import { BillOfLadingSchema, BusinessLicenceSchema, InvoiceSchema, PackingListSchema } from './documents';

export const CheckStatus = z.enum(['pass', 'fail', 'review', 'unavailable', 'skipped']);
export const CheckSeverity = z.enum(['critical', 'high', 'medium', 'low', 'info']);

export const CheckSchema = z.object({
  name: z.string(),
  status: CheckStatus,
  severity: CheckSeverity,
  detail: z.string(),
  /** Risk-score weight subtracted when the check is not `pass` (PLAN 5.6). */
  weight: z.number().int().min(0).max(100),
  evidence: z.unknown().optional(),
  fix: z.string().optional(),
  document: z.string().optional(),
  field: z.string().optional(),
});
export type Check = z.infer<typeof CheckSchema>;

export const ModelCallSchema = z.object({
  stage: z.string(),
  provider: z.string(),
  model_id: z.string(),
  prompt_version: z.string(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  latency_ms: z.number().int(),
  cost_usd: z.number(),
});

export const AdapterMode = z.enum(['live', 'mock', 'unavailable', 'skipped']);

export const RegistryResultSchema = z.object({
  source: z.enum(['gleif', 'qcc', 'fixture', 'none']),
  mode: AdapterMode,
  found: z.boolean(),
  lei: z.string().nullable(),
  legal_name_zh: z.string().nullable(),
  legal_name_en: z.string().nullable(),
  entity_status: z.string().nullable(),
  lei_status: z.string().nullable(),
  country: z.string().nullable(),
  name_match_zh: z.enum(['yes', 'no', 'unsure', 'n/a']),
  name_match_en: z.enum(['yes', 'no', 'unsure', 'n/a']),
  manual_check_url: z.string().url().nullable(),
});

export const SanctionsHitSchema = z.object({
  party: z.string(),
  schema: z.enum(['Company', 'Person', 'Vessel']),
  score: z.number().min(0).max(1),
  match_id: z.string().nullable(),
  match_name: z.string().nullable(),
  datasets: z.array(z.string()),
});

export const PriceCheckSchema = z.object({
  line: z.string(),
  category: z.string().nullable(),
  unit_price_usd: z.number().nullable(),
  reference_low_usd: z.number().nullable(),
  reference_high_usd: z.number().nullable(),
  ratio_to_mid: z.number().nullable(),
  fx: z.object({ from: z.string(), rate: z.number(), source: z.enum(['reflector', 'ecb', 'none']) }).nullable(),
  status: CheckStatus,
});

export const HalalLineSchema = z.object({
  line: z.string(),
  category: z.string(),
  verdict: z.enum(['permitted', 'prohibited', 'review']),
  reason: z.string(),
});

export const ConsistencyJudgmentSchema = z.object({
  field: z.string(),
  match: z.enum(['yes', 'no', 'unsure']),
  reason: z.string(),
  evidence_a: z.string(),
  evidence_b: z.string(),
});

export const VerificationReportSchema = z.object({
  version: z.literal('1.1'),
  stage: z.enum(['listing', 'shipment']),
  deal_ref: z.string(),
  created_at: z.string(),
  decision: DecisionSchema,
  risk_score: z.number().int().min(0).max(100),
  checks: z.array(CheckSchema),
  extracted: z.object({
    invoice: InvoiceSchema.nullable(),
    packing_list: PackingListSchema.nullable(),
    business_licence: BusinessLicenceSchema.nullable(),
    bill_of_lading: BillOfLadingSchema.nullable(),
  }),
  registry: RegistryResultSchema.nullable(),
  sanctions: z.array(SanctionsHitSchema),
  tracking: TrackingSnapshotSchema.nullable(),
  price: z.array(PriceCheckSchema),
  halal: z.array(HalalLineSchema),
  consistency: z.array(ConsistencyJudgmentSchema),
  listing_fingerprint: Hex32.nullable(),
  shipment_fingerprint: Hex32.nullable(),
  document_hashes: z.array(z.object({ type: z.string(), sha256: Hex32 })),
  models: z.array(ModelCallSchema),
  adapter_modes: z.record(z.string(), AdapterMode),
  fixtures_used: z.array(z.string()),
  timings_ms: z.record(z.string(), z.number().int()),
  cost_usd: z.number(),
  injection_attempts: z.array(z.string()),
  explanation: z.string().nullable(),
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

/** Envelope returned by the report endpoints and the x402 job endpoint. */
export const SignedReportSchema = z.object({
  report: VerificationReportSchema,
  report_hash: Hex32,
  purpose: z.number().int(),
  deal_id: z.number().int(),
  signature: Hex64,
  verifier_public_key: Hex32,
  network_passphrase: z.string(),
  contract_id: z.string(),
  verify_howto: z.string(),
});
export type SignedReport = z.infer<typeof SignedReportSchema>;

/** Risk score: start at 100, subtract each non-pass check's weight, floor 0. */
export function riskScore(checks: Check[]): number {
  const penalty = checks.filter((c) => c.status !== 'pass' && c.status !== 'skipped').reduce((s, c) => s + c.weight, 0);
  return Math.max(0, 100 - penalty);
}
