/** Drizzle schema (PLAN 8.2 plus FLOWS 9). Amounts are numeric(30,0) stroops. */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const amount = (name: string) => numeric(name, { precision: 30, scale: 0 });
const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

export const profiles = pgTable('profiles', {
  id: id(),
  authUserId: text('auth_user_id').unique(),
  displayName: text('display_name').notNull(),
  email: text('email'),
  country: text('country'),
  roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
  walletAddress: text('wallet_address').unique(),
  walletKind: text('wallet_kind'), // smart_account | g_account
  kycStatus: text('kyc_status').notNull().default('none'), // none | pending | approved | rejected
  kycApprovedTx: text('kyc_approved_tx'),
  joinedVia: text('joined_via'),
  createdAt: createdAt(),
});

export const importers = pgTable('importers', {
  profileId: uuid('profile_id').primaryKey().references(() => profiles.id),
  legalName: text('legal_name').notNull(),
  country: text('country').notNull(),
  registrationNumber: text('registration_number'),
  kybStatus: text('kyb_status').notNull().default('pending'),
  documents: jsonb('documents').$type<{ documentId: string; type: string }[]>().notNull().default([]),
  faucetGrantTx: text('faucet_grant_tx'),
  createdAt: createdAt(),
});

export const suppliers = pgTable('suppliers', {
  id: id(),
  nameZh: text('name_zh'),
  nameEn: text('name_en').notNull(),
  uscc: text('uscc'),
  country: text('country').notNull().default('CN'),
  payoutAddress: text('payout_address'),
  payoutConfirmedAt: timestamp('payout_confirmed_at', { withTimezone: true }),
  payoutSignature: text('payout_signature'),
  registrySnapshot: jsonb('registry_snapshot'),
  sanctionsResult: jsonb('sanctions_result'),
  firstSeen: createdAt(),
});

export const deals = pgTable(
  'deals',
  {
    id: id(),
    onchainId: bigint('onchain_id', { mode: 'number' }).unique(),
    number: integer('number').notNull().generatedAlwaysAsIdentity(),
    importerId: uuid('importer_id').references(() => profiles.id).notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    status: text('status').notNull().default('draft'), // draft | verifying | approved | review | rejected | promised | listed | ... mirrors chain after listing
    terms: jsonb('terms'),
    currency: text('currency').default('USD'),
    goodsSummary: text('goods_summary').notNull(),
    route: jsonb('route').notNull(),
    carrier: text('carrier'),
    shareToken: text('share_token'),
    issuerPublicKey: text('issuer_public_key'),
    factoryTxHashes: jsonb('factory_tx_hashes').$type<string[]>().default([]),
    reportId: uuid('report_id'),
    blReportId: uuid('bl_report_id'),
    listingFingerprint: text('listing_fingerprint').unique(),
    shipmentFingerprint: text('shipment_fingerprint').unique(),
    paymentMode: text('payment_mode').notNull().default('Native'),
    escrowId: text('escrow_id'),
    security: amount('security'),
    abortReason: text('abort_reason'),
    abortNote: text('abort_note'),
    blReleasedAt: timestamp('bl_released_at', { withTimezone: true }),
    blReleaseNote: text('bl_release_note'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('deals_status_idx').on(t.status), index('deals_importer_idx').on(t.importerId)],
);

export const documents = pgTable('documents', {
  id: id(),
  dealId: uuid('deal_id').references(() => deals.id).notNull(),
  type: text('type').notNull(),
  storagePath: text('storage_path').notNull(),
  sha256: text('sha256').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  pages: integer('pages'),
  uploadedBy: uuid('uploaded_by').references(() => profiles.id),
  stage: text('stage').notNull().default('listing'),
  status: text('status').notNull().default('pending'), // pending | uploaded | replaced
  createdAt: createdAt(),
});

export const reports = pgTable('reports', {
  id: id(),
  dealId: uuid('deal_id').references(() => deals.id),
  stage: text('stage').notNull(),
  canonicalJson: text('canonical_json').notNull(),
  hash: text('hash').notNull(),
  decision: text('decision').notNull(),
  riskScore: integer('risk_score').notNull(),
  signature: text('signature'),
  purpose: integer('purpose'),
  promptVersions: jsonb('prompt_versions'),
  modelIds: jsonb('model_ids'),
  adapterModes: jsonb('adapter_modes'),
  latencyMs: integer('latency_ms'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  explanation: text('explanation'),
  createdAt: createdAt(),
});

export const checks = pgTable('checks', {
  id: id(),
  reportId: uuid('report_id').references(() => reports.id).notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  severity: text('severity').notNull(),
  evidence: jsonb('evidence'),
});

export const externalCalls = pgTable(
  'external_calls',
  {
    id: id(),
    adapter: text('adapter').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response'),
    status: text('status').notNull(),
    cost: numeric('cost', { precision: 12, scale: 6 }),
    mode: text('mode').notNull(),
    cachedUntil: timestamp('cached_until', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('external_calls_req_idx').on(t.adapter, t.requestHash)],
);

export const shipments = pgTable('shipments', {
  dealId: uuid('deal_id').primaryKey().references(() => deals.id),
  carrier: text('carrier').notNull(),
  containerNumbers: text('container_numbers').array().notNull(),
  blNumber: text('bl_number').notNull(),
  blDocumentId: uuid('bl_document_id').references(() => documents.id),
  trackingRequestId: text('tracking_request_id'),
  statusCode: integer('status_code'),
  vessel: text('vessel'),
  imo: text('imo'),
  pol: text('pol'),
  pod: text('pod'),
  departure: timestamp('departure', { withTimezone: true }),
  arrival: timestamp('arrival', { withTimezone: true }),
  events: jsonb('events').default([]),
  mode: text('mode'),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const onchainEvents = pgTable(
  'onchain_events',
  {
    id: id(),
    contractId: text('contract_id').notNull(),
    ledger: integer('ledger').notNull(),
    txHash: text('tx_hash').notNull(),
    eventIndex: integer('event_index').notNull(),
    eventType: text('event_type').notNull(),
    dealOnchainId: bigint('deal_onchain_id', { mode: 'number' }),
    data: jsonb('data').notNull(),
    ledgerClosedAt: timestamp('ledger_closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('onchain_events_tx_idx').on(t.txHash, t.eventIndex), index('onchain_events_deal_idx').on(t.dealOnchainId)],
);

export const agentActions = pgTable('agent_actions', {
  id: id(),
  dealId: uuid('deal_id').references(() => deals.id),
  action: text('action').notNull(),
  decision: text('decision').notNull(),
  reasoning: text('reasoning').notNull(),
  inputs: jsonb('inputs'),
  txHash: text('tx_hash'),
  status: text('status').notNull(),
  dryRun: boolean('dry_run').notNull().default(false),
  createdAt: createdAt(),
});

export const incidents = pgTable('incidents', {
  id: id(),
  dealId: uuid('deal_id').references(() => deals.id),
  kind: text('kind').notNull(),
  detail: text('detail').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: createdAt(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const promises = pgTable('promises', {
  id: id(),
  dealId: uuid('deal_id').references(() => deals.id).notNull(),
  listingFingerprint: text('listing_fingerprint').notNull(),
  text: text('text').notNull(),
  textHash: text('text_hash').notNull(),
  templateVersion: text('template_version').notNull(),
  security: amount('security').notNull(),
  securityBps: integer('security_bps').notNull(),
  onchainTxHash: text('onchain_tx_hash'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  withdrawnTxHash: text('withdrawn_tx_hash'),
  createdAt: createdAt(),
});

export const policy = pgTable('policy', {
  id: id(),
  version: integer('version').notNull(),
  halalCategories: jsonb('halal_categories').notNull(),
  thresholds: jsonb('thresholds').notNull(),
  updatedBy: uuid('updated_by').references(() => profiles.id),
  createdAt: createdAt(),
});

export const x402Payments = pgTable('x402_payments', {
  id: id(),
  requestId: text('request_id').notNull().unique(),
  payer: text('payer'),
  amount: text('amount'),
  txHash: text('tx_hash'),
  reportId: uuid('report_id').references(() => reports.id),
  jobId: uuid('job_id'),
  createdAt: createdAt(),
});

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull().default('queued'), // queued | running | done | failed | dead
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestamp('run_after', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    result: jsonb('result'),
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('jobs_status_run_idx').on(t.status, t.runAfter), uniqueIndex('jobs_dedupe_idx').on(t.dedupeKey)],
);

export const auditLog = pgTable('audit_log', {
  id: id(),
  actor: uuid('actor').references(() => profiles.id),
  action: text('action').notNull(),
  target: text('target').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason'),
  createdAt: createdAt(),
});

export const indexerCursor = pgTable('indexer_cursor', {
  contractId: text('contract_id').primaryKey(),
  cursor: text('cursor'),
  lastLedger: integer('last_ledger'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const extensionRequests = pgTable('extension_requests', {
  id: id(),
  dealId: uuid('deal_id').references(() => deals.id).notNull(),
  reason: text('reason').notNull(),
  requestedSecs: integer('requested_secs').notNull(),
  status: text('status').notNull().default('pending'), // pending | granted | refused
  decisionNote: text('decision_note'),
  decidedBy: uuid('decided_by').references(() => profiles.id),
  txHash: text('tx_hash'),
  createdAt: createdAt(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export const supplierConfirmations = pgTable('supplier_confirmations', {
  id: id(),
  dealId: uuid('deal_id').references(() => deals.id).notNull(),
  token: text('token').notNull().unique(),
  payoutAddress: text('payout_address'),
  signature: text('signature'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const notifications = pgTable('notifications', {
  id: id(),
  profileId: uuid('profile_id').references(() => profiles.id),
  kind: text('kind').notNull(),
  dealId: uuid('deal_id').references(() => deals.id),
  payload: jsonb('payload'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  error: text('error'),
  createdAt: createdAt(),
});
