/**
 * Extraction schemas for the four document types (PLAN 5.2). Every key field is a
 * `Field`: value, verbatim evidence quote, page and confidence. A field without
 * evidence counts as missing (PLAN 5.5).
 */
import { z } from 'zod';

export const field = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    evidence: z.string().nullable(),
    page: z.number().int().positive().nullable(),
    confidence: z.number().min(0).max(1),
  });
export type Field<T> = { value: T | null; evidence: string | null; page: number | null; confidence: number };

const str = field(z.string());
const num = field(z.number());
const isoDate = field(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const PartySchema = z.object({
  name_en: str,
  name_zh: str,
  uscc: str,
  address: str,
  country: str,
});
export type Party = z.infer<typeof PartySchema>;

export const InvoiceLineSchema = z.object({
  description_en: str,
  description_zh: str,
  hs_code: str,
  quantity: num,
  unit: str,
  unit_price: num,
  line_total: num,
});

export const InvoiceSchema = z.object({
  type: z.literal('invoice'),
  invoice_number: str,
  invoice_date: isoDate,
  invoice_kind: field(z.enum(['proforma', 'commercial'])),
  seller: PartySchema,
  buyer: PartySchema,
  consignee: PartySchema.nullable(),
  notify_party: str,
  incoterms: str,
  currency: str,
  total: num,
  line_items: z.array(InvoiceLineSchema).min(1).max(100),
  port_of_loading: str,
  port_of_discharge: str,
  payment_terms: str,
  hidden_or_suspicious_text: z.array(z.string()),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const PackingLineSchema = z.object({
  description_en: str,
  quantity: num,
  packages: num,
  gross_weight_kg: num,
  net_weight_kg: num,
  cbm: num,
});

export const PackingListSchema = z.object({
  type: z.literal('packing_list'),
  packing_list_number: str,
  date: isoDate,
  invoice_number: str,
  seller: PartySchema,
  buyer: PartySchema,
  items: z.array(PackingLineSchema).min(1).max(100),
  total_packages: num,
  total_gross_weight_kg: num,
  total_net_weight_kg: num,
  total_cbm: num,
  container_numbers: z.array(str),
  hidden_or_suspicious_text: z.array(z.string()),
});
export type PackingList = z.infer<typeof PackingListSchema>;

export const BusinessLicenceSchema = z.object({
  type: z.literal('business_licence'),
  name_zh: str,
  name_en: str,
  uscc: str,
  legal_representative: str,
  company_type: str,
  registered_capital: str,
  establishment_date: isoDate,
  business_term: str,
  business_scope: str,
  address: str,
  registration_authority: str,
  issue_date: isoDate,
  hidden_or_suspicious_text: z.array(z.string()),
});
export type BusinessLicence = z.infer<typeof BusinessLicenceSchema>;

export const BlContainerSchema = z.object({
  number: str,
  seal: str,
  packages: num,
  gross_weight_kg: num,
  size_type: str,
});

export const BillOfLadingSchema = z.object({
  type: z.literal('bill_of_lading'),
  bl_number: str,
  bl_kind: field(z.enum(['original', 'seaway', 'telex_release', 'house', 'master'])),
  carrier: str,
  scac: str,
  shipper: PartySchema,
  consignee: str,
  consignee_to_order: field(z.boolean()),
  notify_party: str,
  vessel: str,
  voyage: str,
  imo: str,
  port_of_loading: str,
  port_of_discharge: str,
  place_of_receipt: str,
  place_of_delivery: str,
  shipped_on_board_date: isoDate,
  issue_date: isoDate,
  containers: z.array(BlContainerSchema).min(1).max(50),
  description_of_goods: str,
  total_packages: num,
  gross_weight_kg: num,
  measurement_cbm: num,
  freight_terms: str,
  hidden_or_suspicious_text: z.array(z.string()),
});
export type BillOfLading = z.infer<typeof BillOfLadingSchema>;

export const ExtractedDocumentSchema = z.discriminatedUnion('type', [
  InvoiceSchema,
  PackingListSchema,
  BusinessLicenceSchema,
  BillOfLadingSchema,
]);
export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;

export const extractionSchemaFor = {
  invoice: InvoiceSchema,
  packing_list: PackingListSchema,
  business_licence: BusinessLicenceSchema,
  bill_of_lading: BillOfLadingSchema,
} as const;

/** Key fields whose confidence below 0.8 sends the deal to review (PLAN 5.5). */
export const KEY_FIELDS: Record<keyof typeof extractionSchemaFor, string[]> = {
  invoice: ['invoice_number', 'invoice_date', 'seller.name_zh', 'seller.uscc', 'buyer.name_en', 'currency', 'total'],
  packing_list: ['total_gross_weight_kg', 'total_packages'],
  business_licence: ['name_zh', 'uscc', 'legal_representative'],
  bill_of_lading: ['bl_number', 'carrier', 'vessel', 'port_of_loading', 'shipped_on_board_date', 'consignee', 'containers'],
};

export const KEY_FIELD_MIN_CONFIDENCE = 0.8;
