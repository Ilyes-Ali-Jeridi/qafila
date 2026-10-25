/**
 * API payload schemas shared with the web app (Track C's apps/web/lib/api/schemas.ts moved
 * here so both sides use one definition). Add, never rename.
 */
import { z } from 'zod';
import { DealDetailSchema, DealStateSchema, DealSummarySchema, DecisionSchema, Hex32, Hex64, ImporterStatsSchema, OnchainEventSchema, StellarAddress, TxHash, AmountString } from './schemas';
import { DocumentTypeSchema } from './schemas';
import { VerificationReportSchema } from './report';

export const RoleSchema = z.enum(['investor', 'importer', 'ops', 'sharia']);
export type Role = z.infer<typeof RoleSchema>;
export const KycStatusSchema = z.enum(['none', 'pending', 'approved', 'rejected']);

export const MeSchema = z.object({
  profile: z.object({
    id: z.string(),
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    country: z.string().nullable(),
    roles: z.array(RoleSchema),
    walletAddress: StellarAddress.nullable(),
    walletKind: z.enum(['smart_account', 'g_account']).nullable(),
    kycStatus: KycStatusSchema,
    joinedVia: z.string().nullable(),
    createdAt: z.string(),
  }),
  investorApproved: z.boolean(),
  investorApproveTxHash: TxHash.nullable(),
  importer: z
    .object({
      legalName: z.string(),
      country: z.string(),
      registrationNumber: z.string(),
      kybStatus: KycStatusSchema,
      limit: AmountString,
      openExposure: AmountString,
      nextSecurityBps: z.number().int(),
      stats: ImporterStatsSchema,
      faucetGrant: z.object({ amount: AmountString, txHash: TxHash }).nullable(),
    })
    .nullable(),
});
export type Me = z.infer<typeof MeSchema>;

export const KycResponseSchema = z.object({
  kycStatus: KycStatusSchema,
  approveTxHash: TxHash.nullable(),
  faucet: z.object({ amount: AmountString, txHash: TxHash }).nullable(),
});
export type KycResponse = z.infer<typeof KycResponseSchema>;

export const KybRequest = z.object({
  legalName: z.string().min(2).max(120),
  country: z.string().length(2),
  registrationNumber: z.string().min(3).max(40),
  documentId: z.string().uuid().nullable(),
  displayName: z.string().min(1).max(80),
  email: z.string().email().optional(),
});
export type KybRequest = z.infer<typeof KybRequest>;

export const FaucetResponseSchema = z.object({ amount: AmountString, txHash: TxHash, mode: z.enum(['live', 'mock']) });

export const JoinRequest = z.object({
  displayName: z.string().min(1).max(80),
  address: StellarAddress,
  riskAcknowledged: z.literal(true),
  country: z.string().length(2).optional(),
  email: z.string().email().optional(),
});

export const PortfolioPositionSchema = z.object({
  dealId: z.string(),
  number: z.number().int(),
  onchainId: z.number().int().nullable(),
  goodsSummary: z.string(),
  route: z.string(),
  state: DealStateSchema.nullable(),
  shares: AmountString,
  expectedProfit: AmountString,
  realisedProfit: AmountString.nullable(),
  claimable: AmountString.nullable(),
  claimed: z.boolean(),
  claimTxHash: TxHash.nullable(),
  investTxHash: TxHash.nullable(),
  investedAt: z.string(),
  dueAt: z.number().int().nullable(),
  tenorSecs: z.number().int(),
});
export type PortfolioPosition = z.infer<typeof PortfolioPositionSchema>;

export const PortfolioSchema = z.object({
  positions: z.array(PortfolioPositionSchema),
  totals: z.object({ invested: AmountString, expectedProfit: AmountString, realisedProfit: AmountString, claimable: AmountString }),
  refundOwed: AmountString,
});
export type Portfolio = z.infer<typeof PortfolioSchema>;

export const EventFeedItemSchema = OnchainEventSchema.extend({ dealNumber: z.number().int().nullable(), dealId: z.string().nullable(), summary: z.string() });
export const EventFeedSchema = z.array(EventFeedItemSchema);
export type EventFeedItem = z.infer<typeof EventFeedItemSchema>;

export const CharityLedgerSchema = z.object({
  address: StellarAddress.nullable(),
  total: AmountString,
  owed: AmountString,
  entries: z.array(z.object({ kind: z.enum(['late_fee', 'dust', 'sweep']), amount: AmountString, txHash: TxHash, dealNumber: z.number().int().nullable(), at: z.string() })),
});
export type CharityLedger = z.infer<typeof CharityLedgerSchema>;

export const DocumentRecordSchema = z.object({
  id: z.string(),
  type: DocumentTypeSchema,
  filename: z.string(),
  mime: z.string(),
  size: z.number().int(),
  sha256: Hex32,
  pages: z.number().int().nullable(),
  stage: z.enum(['listing', 'shipment', 'kyb']),
  status: z.enum(['pending_upload', 'uploaded']),
  uploadedAt: z.string(),
  viewUrl: z.string().nullable(),
});
export type DocumentRecord = z.infer<typeof DocumentRecordSchema>;

export const FixSchema = z.object({ check: z.string(), document: z.string().nullable(), field: z.string().nullable(), fix: z.string() });

export const ReportResponseSchema = z.object({
  report: VerificationReportSchema,
  reportHash: Hex32,
  signature: Hex64.nullable(),
  verifierPublicKey: Hex32.nullable(),
  stage: z.enum(['listing', 'shipment']),
  decision: DecisionSchema,
  riskScore: z.number().int(),
  explanation: z.string().nullable(),
  rejectCategory: z.enum(['identity', 'sanctions', 'duplicate', 'prohibited_goods', 'document_integrity', 'shipment_mismatch']).nullable(),
  fixes: z.array(FixSchema),
  createdAt: z.string(),
});
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

export const ImporterStageSchema = z.enum([
  'draft',
  'verifying',
  'review',
  'rejected',
  'approved',
  'promised',
  'listed',
  'funded',
  'deposit_paid',
  'owned',
  'sold',
  'repaid',
  'closed',
  'cancelled',
  'defaulted',
  'liquidated',
]);
export type ImporterStage = z.infer<typeof ImporterStageSchema>;

export const PromiseStateSchema = z.object({
  textHash: Hex32,
  listingFingerprint: Hex32,
  security: AmountString,
  securityBps: z.number().int(),
  txHash: TxHash.nullable(),
  signedAt: z.string().nullable(),
  withdrawable: z.boolean(),
  text: z.string(),
});

export const ImporterDealSchema = DealSummarySchema.extend({
  stage: ImporterStageSchema,
  nextAction: z.string(),
  supplier: z.object({ nameEn: z.string(), nameZh: z.string().nullable(), uscc: z.string().nullable(), payoutAddress: StellarAddress.nullable(), confirmed: z.boolean() }),
  terms: z.object({
    cost: AmountString,
    markup: AmountString,
    platformFee: AmountString,
    lateFee: AmountString,
    depositBps: z.number().int(),
    tenorSecs: z.number().int(),
    acceptWindowSecs: z.number().int(),
    fundingDeadline: z.number().int().nullable(),
  }),
  documents: z.array(DocumentRecordSchema),
  reportSummary: z.object({ decision: DecisionSchema, riskScore: z.number().int(), explanation: z.string().nullable(), fixCount: z.number().int(), createdAt: z.string() }).nullable(),
  promise: PromiseStateSchema.nullable(),
  shipment: z.object({ carrier: z.string(), blNumber: z.string(), containers: z.array(z.string()), status: z.string().nullable(), documentId: z.string().nullable() }).nullable(),
  refundOwed: AmountString,
  extension: z.object({ requested: z.boolean(), reason: z.string().nullable(), decision: z.enum(['pending', 'granted', 'refused']).nullable(), newDueAt: z.number().int().nullable() }).nullable(),
});
export type ImporterDeal = z.infer<typeof ImporterDealSchema>;

export const ImporterDealDetailSchema = DealDetailSchema.merge(ImporterDealSchema);
export type ImporterDealDetail = z.infer<typeof ImporterDealDetailSchema>;

export const CreateDealResponseSchema = z.object({ id: z.string(), number: z.number().int(), status: z.literal('draft') });
export const RegisterDocumentResponseSchema = z.object({ documentId: z.string(), uploadUrl: z.string(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()) });
export const VerifyResponseSchema = z.object({ jobId: z.string() });
export const ShipmentResponseSchema = z.object({ shipmentId: z.string(), jobId: z.string().nullable() });
export const TxSubmittedRequest = z.object({ txHash: TxHash });
export const OkSchema = z.object({ ok: z.literal(true) });

export const UpdateDealTermsRequest = z.object({
  cost: AmountString.optional(),
  markup: AmountString.optional(),
  tenorSecs: z.number().int().positive().optional(),
  depositBps: z.number().int().min(0).max(10000).optional(),
  supplierPayoutAddress: StellarAddress.optional(),
});

// ------------------------------------------------------------------ ops

export const OpsQueueItemSchema = DealSummarySchema.extend({
  importerName: z.string(),
  supplierName: z.string(),
  stage: ImporterStageSchema,
  pendingAction: z.enum(['review_report', 'list', 'pay_deposit', 'confirm_shipment', 'release_bl', 'mark_default', 'finalize', 'extension']).nullable(),
  openIncidents: z.number().int(),
  updatedAt: z.string(),
});
export type OpsQueueItem = z.infer<typeof OpsQueueItemSchema>;

export const AuditEntrySchema = z.object({ id: z.string(), actor: z.string(), action: z.string(), reason: z.string().nullable(), at: z.string(), txHash: TxHash.nullable() });
export const IncidentSchema = z.object({ id: z.string(), dealNumber: z.number().int().nullable(), kind: z.string(), detail: z.string(), status: z.enum(['open', 'resolved']), at: z.string() });
export const AgentActionSchema = z.object({
  id: z.string(),
  dealNumber: z.number().int().nullable(),
  action: z.string(),
  decision: z.string(),
  reasoning: z.string(),
  txHash: TxHash.nullable(),
  status: z.enum(['done', 'skipped', 'failed', 'dry_run']),
  at: z.string(),
});
export const RecoverySchema = z.object({ amount: AmountString, from: StellarAddress.nullable(), note: z.string(), txHash: TxHash.nullable(), at: z.string() });

export const OpsDealDetailSchema = ImporterDealDetailSchema.extend({
  importer: z.object({
    displayName: z.string(),
    legalName: z.string(),
    country: z.string(),
    registrationNumber: z.string(),
    kybStatus: KycStatusSchema,
    walletAddress: StellarAddress.nullable(),
    stats: ImporterStatsSchema,
    limit: AmountString,
  }),
  listing: z.object({ shareToken: z.string().nullable(), issuerPublicKey: z.string().nullable(), txHashes: z.record(z.string(), TxHash) }).nullable(),
  audit: z.array(AuditEntrySchema),
  incidents: z.array(IncidentSchema),
  agentActions: z.array(AgentActionSchema),
  recoveries: z.array(RecoverySchema),
  recoveryNotes: z.array(z.object({ note: z.string(), at: z.string(), by: z.string() })),
  abort: z.object({ reason: z.string(), importerAtFault: z.boolean(), note: z.string(), at: z.string(), txHash: TxHash.nullable() }).nullable(),
});
export type OpsDealDetail = z.infer<typeof OpsDealDetailSchema>;

export const OpsActionResponseSchema = z.object({ ok: z.literal(true), txHash: TxHash.nullable(), txHashes: z.record(z.string(), TxHash).nullable(), message: z.string().nullable() });
export type OpsActionResponse = z.infer<typeof OpsActionResponseSchema>;

export const OverrideRequest = z.object({ decision: DecisionSchema, reason: z.string().min(10).max(2000) });
export const RecoveryRequest = z.object({ amount: AmountString, from: StellarAddress.optional(), note: z.string().min(3).max(2000) });
export const NoteRequest = z.object({ note: z.string().min(3).max(2000) });
export const ExtendRequest = z.object({ newDueAt: z.number().int(), note: z.string().min(3).max(2000) });
export const ExtensionRequest = z.object({ reason: z.string().min(10).max(2000) });

export const KycQueueItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['investor', 'importer']),
  displayName: z.string(),
  country: z.string(),
  walletAddress: StellarAddress.nullable(),
  legalName: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  documents: z.array(DocumentRecordSchema),
  submittedAt: z.string(),
  status: KycStatusSchema,
});
export const KycQueueSchema = z.array(KycQueueItemSchema);

export const AgentLogSchema = z.object({
  actions: z.array(AgentActionSchema),
  incidents: z.array(IncidentSchema),
  deadJobs: z.array(z.object({ id: z.string(), kind: z.string(), lastError: z.string().nullable(), attempts: z.number().int() })),
  agentAddress: StellarAddress.nullable(),
  mode: z.enum(['live', 'dry_run', 'off']),
});
export type AgentLog = z.infer<typeof AgentLogSchema>;

export const PolicySchema = z.object({
  version: z.number().int(),
  categories: z.array(z.object({ name: z.string(), verdict: z.enum(['permitted', 'prohibited', 'review']), note: z.string() })),
  thresholds: z.object({
    priceRatioLow: z.number(),
    priceRatioHigh: z.number(),
    weightReviewPct: z.number(),
    weightRejectPct: z.number(),
    sanctionsReview: z.number(),
    sanctionsReject: z.number(),
    keyFieldMinConfidence: z.number(),
  }),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
});
export type Policy = z.infer<typeof PolicySchema>;
export const PolicyUpdateRequest = PolicySchema.omit({ version: true, updatedBy: true, updatedAt: true });

export const TradeFileSchema = z.object({ url: z.string(), filename: z.string(), bytes: z.number().int(), contents: z.array(z.string()) });

export const PurchaseOrderSchema = z.object({
  dealNumber: z.number().int(),
  entityName: z.string(),
  supplierName: z.string(),
  goodsSummary: z.string(),
  cost: AmountString,
  depositBps: z.number().int(),
  payoutAddress: StellarAddress.nullable(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  acceptedAt: z.string().nullable(),
  signature: z.string().nullable(),
});
