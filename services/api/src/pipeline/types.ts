/** Shared pipeline types: inputs, dependencies and per-stage results. */
import type { Check, DocumentType, ExtractedDocument, HalalLineSchema, ModelCallSchema, VerificationReport } from '@qafila/shared';
import type { z } from 'zod';
import type { Adapters } from '../adapters/index.js';
import type { IngestedDocument } from './documents.js';

export interface DealContext {
  dealRef: string; // database id or eval packet id
  dealNumber: number;
  entityName: string;
  importer: { name: string; country: string; address?: string };
  supplier: { nameEn: string; nameZh?: string; uscc?: string; country: string };
  goodsSummary: string;
  currency?: string;
  incoterms?: string;
  originPort: string;
  destinationPort: string;
  destinationCountry: string;
  carrier?: string;
  containers?: string[];
  blNumber?: string;
  /** Ops override after a manual registry check (audit-logged): counts as passed (PLAN 5.6). */
  registryOverride?: boolean;
}

export interface InputDocument {
  type: DocumentType;
  filename: string;
  bytes: Uint8Array;
  mime?: string;
}

export interface HalalPolicyCategory {
  id: string;
  label: string;
  verdict: 'permitted' | 'prohibited' | 'review';
  description: string;
}

export interface HalalPolicy {
  version: number;
  categories: HalalPolicyCategory[];
  thresholds: { priceRatioLow: number; priceRatioHigh: number; sanctionsReview: number; sanctionsReject: number; weightReviewPct: number; weightRejectPct: number; keyFieldMinConfidence: number };
}

/** Fingerprints already financed (database in the API, memory in the eval). */
export interface FingerprintStore {
  hasListing(hex: string): Promise<string | null>; // returns the deal ref that used it
  hasShipment(hex: string): Promise<string | null>;
  addListing(hex: string, dealRef: string): Promise<void>;
  addShipment(hex: string, dealRef: string): Promise<void>;
}

export class MemoryFingerprintStore implements FingerprintStore {
  readonly listing = new Map<string, string>();
  readonly shipment = new Map<string, string>();
  async hasListing(hex: string): Promise<string | null> {
    return this.listing.get(hex) ?? null;
  }
  async hasShipment(hex: string): Promise<string | null> {
    return this.shipment.get(hex) ?? null;
  }
  async addListing(hex: string, dealRef: string): Promise<void> {
    this.listing.set(hex, dealRef);
  }
  async addShipment(hex: string, dealRef: string): Promise<void> {
    this.shipment.set(hex, dealRef);
  }
}

export interface PipelineDeps {
  adapters: Adapters;
  policy: HalalPolicy;
  fingerprints: FingerprintStore;
  verifierSecret: string | null;
  contractId: string | null;
  networkPassphrase: string;
  /** Fixed "today" for deterministic tests. */
  today?: string;
}

export type ModelCall = z.infer<typeof ModelCallSchema>;
export type HalalLine = z.infer<typeof HalalLineSchema>;

export interface ExtractedSet {
  invoice: Extract<ExtractedDocument, { type: 'invoice' }> | null;
  packing_list: Extract<ExtractedDocument, { type: 'packing_list' }> | null;
  business_licence: Extract<ExtractedDocument, { type: 'business_licence' }> | null;
  bill_of_lading: Extract<ExtractedDocument, { type: 'bill_of_lading' }> | null;
}

export interface IngestedInput {
  type: DocumentType;
  filename: string;
  doc: IngestedDocument;
}

export interface StageOutput {
  checks: Check[];
  models: ModelCall[];
  fixtures: string[];
  timings: Record<string, number>;
}

export interface PipelineResult {
  report: VerificationReport;
  reportHash: string; // hex
  canonical: string;
  signature: string | null; // hex, purpose 10
  verifierPublicKey: string | null; // hex
  extracted: ExtractedSet;
  ingested: IngestedInput[];
}
