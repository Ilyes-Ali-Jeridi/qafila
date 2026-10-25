/**
 * zod schemas for API payloads. i128 amounts travel as decimal strings in JSON;
 * u64 timestamps as numbers (seconds). Contract types are mirrored here so the
 * web app never depends on the generated client for display.
 */
import { z } from 'zod';
import { DEAL_STATES, DECISIONS, DOCUMENT_TYPES, FEATURE_FLAGS, PAYMENT_MODES, ABORT_REASONS } from './constants';

export const AmountString = z.string().regex(/^-?\d+$/, 'i128 as decimal string');
export type AmountString = z.infer<typeof AmountString>;
export const Hex32 = z.string().regex(/^[0-9a-f]{64}$/, '32 bytes hex');
export const Hex64 = z.string().regex(/^[0-9a-f]{128}$/, '64 bytes hex');
export const StellarAddress = z.string().regex(/^[GC][A-Z2-7]{55}$/, 'G or C address');
export const GAddress = z.string().regex(/^G[A-Z2-7]{55}$/, 'G address');
export const CAddress = z.string().regex(/^C[A-Z2-7]{55}$/, 'contract address');
export const TxHash = Hex32;

export const DealStateSchema = z.enum(DEAL_STATES);
export const PaymentModeSchema = z.enum(PAYMENT_MODES);
export const DecisionSchema = z.enum(DECISIONS);
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export const AbortReasonSchema = z.enum(Object.keys(ABORT_REASONS) as [keyof typeof ABORT_REASONS, ...(keyof typeof ABORT_REASONS)[]]);

export const ConfigSchema = z.object({
  max_markup_bps: z.number().int().nonnegative(),
  max_deposit_bps: z.number().int().nonnegative(),
  max_investors_per_deal: z.number().int().positive(),
  min_tenor_secs: z.number().int().nonnegative(),
  grace_secs: z.number().int().nonnegative(),
  base_importer_limit: AmountString,
  limit_step: AmountString,
  min_security_bps: z.number().int().nonnegative(),
  security_step_bps: z.number().int().nonnegative(),
  security_floor_bps: z.number().int().nonnegative(),
  max_extension_secs: z.number().int().nonnegative(),
});
export type ContractConfig = z.infer<typeof ConfigSchema>;

export const DealTermsSchema = z.object({
  importer: StellarAddress,
  supplier: StellarAddress,
  share_token: CAddress,
  payout_token: CAddress,
  cost: AmountString,
  deposit_bps: z.number().int().min(0).max(10000),
  markup: AmountString,
  platform_fee: AmountString,
  late_fee: AmountString,
  funding_deadline: z.number().int(),
  accept_window_secs: z.number().int().positive(),
  tenor_secs: z.number().int().positive(),
  listing_fingerprint: Hex32,
  report_hash: Hex32,
  promise_hash: Hex32,
  halal_ok: z.boolean(),
  payment_mode: PaymentModeSchema,
  security: AmountString,
});
export type DealTerms = z.infer<typeof DealTermsSchema>;

export const DealSchema = z.object({
  id: z.number().int(),
  terms: DealTermsSchema,
  state: DealStateSchema,
  listed_at: z.number().int(),
  funded: AmountString,
  supplier_paid: AmountString,
  owned_at: z.number().int(),
  bl_fingerprint: Hex32.nullable(),
  bl_report_hash: Hex32.nullable(),
  sale_price: AmountString,
  accepted_at: z.number().int(),
  due_at: z.number().int(),
  principal_repaid: AmountString,
  late_fee_due: AmountString,
  late_fee_paid: AmountString,
  recovered: AmountString,
  distributable: AmountString,
  claimed_shares: AmountString,
  paid_out: AmountString,
  holder_count: z.number().int(),
  security: AmountString,
  importer_at_fault: z.boolean(),
  extended: z.boolean(),
});
export type OnchainDeal = z.infer<typeof DealSchema>;

export const PromiseRecordSchema = z.object({
  importer: StellarAddress,
  promise_hash: Hex32,
  security: AmountString,
  at: z.number().int(),
  listed: z.boolean(),
});

export const ImporterStatsSchema = z.object({
  on_time: z.number().int(),
  late: z.number().int(),
  defaulted: z.number().int(),
  total_repaid: AmountString,
  open_exposure: AmountString,
});
export type ImporterStats = z.infer<typeof ImporterStatsSchema>;

// ------------------------------------------------------------------ API: public

export const FlagsSchema = z.object(Object.fromEntries(FEATURE_FLAGS.map((f) => [f, z.boolean()])) as Record<(typeof FEATURE_FLAGS)[number], z.ZodBoolean>);
export type Flags = z.infer<typeof FlagsSchema>;

/** GET /config: the web app reads everything chain-related from here at runtime. */
export const PublicConfigSchema = z.object({
  network: z.enum(['local', 'testnet', 'mainnet']),
  rpcUrl: z.string().url(),
  horizonUrl: z.string().url(),
  networkPassphrase: z.string().min(1),
  contractId: CAddress.nullable(),
  settlementToken: z.object({ id: CAddress.nullable(), code: z.string(), issuer: GAddress.nullable(), label: z.string() }),
  x402UsdcTokenId: CAddress.nullable(),
  charityAddress: StellarAddress.nullable(),
  treasuryAddress: StellarAddress.nullable(),
  verifierPublicKey: Hex32.nullable(),
  smartAccount: z.object({
    wasmHash: Hex32.nullable(),
    webauthnVerifier: CAddress.nullable(),
    relayerUrl: z.string().nullable(),
    rpId: z.string(),
  }),
  entityName: z.string(),
  coinvestBps: z.number().int(),
  flags: FlagsSchema,
  version: z.string(),
});
export type PublicConfig = z.infer<typeof PublicConfigSchema>;

export const HealthSchema = z.object({
  ok: z.boolean(),
  time: z.string(),
  rpc: z.object({ ok: z.boolean(), latencyMs: z.number().nullable(), protocol: z.number().nullable() }),
  db: z.object({ ok: z.boolean(), latencyMs: z.number().nullable() }),
  indexerLagSecs: z.number().nullable(),
  adapters: z.record(z.string(), z.enum(['live', 'mock', 'off'])),
  version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

export const StatsSchema = z.object({
  walletsCreated: z.number().int(),
  approvedInvestors: z.number().int(),
  dealsByState: z.record(DealStateSchema, z.number().int()),
  funded: AmountString,
  profitPaid: AmountString,
  charityTotal: AmountString,
  securityLocked: AmountString,
  refundsPaid: AmountString,
  joinedDuringEvent: z.number().int(),
  updatedAt: z.string(),
});
export type Stats = z.infer<typeof StatsSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ------------------------------------------------------------------ API: deals

export const RouteSchema = z.object({
  originPort: z.string(),
  originCountry: z.string(),
  destinationPort: z.string(),
  destinationCountry: z.string(),
  originLngLat: z.tuple([z.number(), z.number()]).nullable(),
  destinationLngLat: z.tuple([z.number(), z.number()]).nullable(),
});

export const DealSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  onchainId: z.number().int().nullable(),
  status: z.string(),
  state: DealStateSchema.nullable(),
  goodsSummary: z.string(),
  route: RouteSchema,
  cost: AmountString,
  markup: AmountString,
  platformFee: AmountString,
  security: AmountString,
  tenorSecs: z.number().int(),
  funded: AmountString,
  fundingDeadline: z.number().int().nullable(),
  decision: DecisionSchema.nullable(),
  riskScore: z.number().int().min(0).max(100).nullable(),
  importerHistory: ImporterStatsSchema.nullable(),
  shareToken: CAddress.nullable(),
  createdAt: z.string(),
});
export type DealSummary = z.infer<typeof DealSummarySchema>;

export const OnchainEventSchema = z.object({
  txHash: TxHash,
  ledger: z.number().int(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
  at: z.string(),
});

export const TrackingEventSchema = z.object({
  at: z.string().nullable(),
  location: z.string().nullable(),
  description: z.string(),
  vessel: z.string().nullable(),
  voyage: z.string().nullable(),
  isActual: z.boolean(),
});

export const TrackingSnapshotSchema = z.object({
  mode: z.enum(['live', 'mock']),
  statusCode: z.number().int().nullable(),
  status: z.string().nullable(),
  vessel: z.string().nullable(),
  imo: z.string().nullable(),
  pol: z.string().nullable(),
  pod: z.string().nullable(),
  departure: z.string().nullable(),
  arrival: z.string().nullable(),
  containers: z.array(z.string()),
  events: z.array(TrackingEventSchema),
  lastPolledAt: z.string().nullable(),
});
export type TrackingSnapshot = z.infer<typeof TrackingSnapshotSchema>;

export const PaymentRecordSchema = z.object({
  kind: z.enum(['supplier_deposit', 'supplier_balance', 'security_locked', 'security_applied', 'security_refunded', 'repayment', 'late_fee', 'claim', 'recovery', 'sweep']),
  amount: AmountString,
  txHash: TxHash.nullable(),
  at: z.string(),
});

export const DealDetailSchema = DealSummarySchema.extend({
  onchain: DealSchema.nullable(),
  publicReport: z
    .object({
      stage: z.enum(['listing', 'shipment']),
      decision: DecisionSchema,
      riskScore: z.number().int(),
      reportHash: Hex32,
      signature: Hex64.nullable(),
      checks: z.array(z.object({ name: z.string(), status: z.string(), severity: z.string(), detail: z.string() })),
      adapterModes: z.record(z.string(), z.string()),
      createdAt: z.string(),
    })
    .nullable(),
  tracking: TrackingSnapshotSchema.nullable(),
  timeline: z.array(OnchainEventSchema),
  payments: z.array(PaymentRecordSchema),
  issuer: z.object({ publicKey: GAddress, locked: z.boolean(), flags: z.array(z.string()) }).nullable(),
  escrowId: z.string().nullable(),
  lossOrder: z.array(z.string()),
  worstCase: z.object({ investorRecoveryBps: z.number().int(), note: z.string() }),
});
export type DealDetail = z.infer<typeof DealDetailSchema>;

// ------------------------------------------------------------------ API: requests

export const CreateDealRequest = z.object({
  supplier: z.object({
    nameEn: z.string().min(1),
    nameZh: z.string().optional(),
    uscc: z.string().length(18).optional(),
    country: z.string().length(2).default('CN'),
    payoutAddress: StellarAddress.optional(),
  }),
  goodsSummary: z.string().min(3).max(200),
  incoterms: z.string().optional(),
  originPort: z.string().min(1),
  destinationPort: z.string().min(1),
  destinationCountry: z.string().length(2),
  carrier: z.string().optional(),
  tenorSecs: z.number().int().positive(),
});
export type CreateDealRequest = z.infer<typeof CreateDealRequest>;

export const RegisterDocumentRequest = z.object({
  type: DocumentTypeSchema,
  filename: z.string().min(1),
  mime: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  size: z.number().int().positive().max(15 * 1024 * 1024),
  sha256: Hex32,
});

export const PromiseResponse = z.object({
  text: z.string(),
  textHash: Hex32,
  listingFingerprint: Hex32,
  security: AmountString,
  securityBps: z.number().int(),
  cost: AmountString,
  templateVersion: z.string(),
});
export type PromiseResponse = z.infer<typeof PromiseResponse>;

export const ShipmentRequest = z.object({
  carrier: z.string().min(2),
  blNumber: z.string().min(3),
  containers: z.array(z.string().regex(/^[A-Z]{4}\d{7}$/)).min(1).max(20),
  documentId: z.string().uuid(),
});

export const AbortRequest = z.object({
  reason: AbortReasonSchema,
  importerAtFault: z.boolean().optional(),
  note: z.string().min(3).max(2000),
});

export const KycRequest = z.object({
  displayName: z.string().min(1).max(80),
  country: z.string().length(2),
  email: z.string().email().optional(),
  riskAcknowledged: z.literal(true),
});

export const WalletLinkRequest = z.object({
  address: StellarAddress,
  kind: z.enum(['smart_account', 'g_account']),
});

export const JobStatusSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed', 'dead']),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  result: z.unknown().nullable(),
});
