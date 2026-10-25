/**
 * In-memory world for the mock API: the three demo deals from PLAN 3.4 / FLOWS 4 plus a
 * repaid, a cancelled, a review and a rejected deal, so every screen has real-looking data.
 * Amounts are i128 stroops (bigint); JSON gets decimal strings.
 */
import { ONE, requiredSecurity, renderPromiseText, PROMISE_TEMPLATE_VERSION, riskScore as computeRisk, type DealStateName, type ImporterStats, type Check, type PaymentRecordSchema, type TrackingSnapshot, type VerificationReport } from '@qafila/shared';
import type { z } from 'zod';
import type { DocumentRecord, ImporterStage, ReportResponse, EventFeedItem, Policy } from '../lib/api/schemas';
import { DAY, HOUR, fakeC, fakeG, fakeTx, iso, nowIso, nowSecs, randomUuid, sha256hex, uuid } from './util.js';

type PaymentRecord = z.infer<typeof PaymentRecordSchema>;

export const SECURITY_CFG = { minSecurityBps: 2000, securityStepBps: 250, securityFloorBps: 1000 };
export const CONTRACT_CFG = {
  max_markup_bps: 1500,
  max_deposit_bps: 3000,
  max_investors_per_deal: 100,
  min_tenor_secs: 60,
  grace_secs: 60,
  base_importer_limit: (15_000n * ONE).toString(),
  limit_step: (5_000n * ONE).toString(),
  ...{ min_security_bps: 2000, security_step_bps: 250, security_floor_bps: 1000, max_extension_secs: 600 },
};
export const COINVEST_BPS = 500;
export const ENTITY_NAME = 'Qafila Trade';

export interface MockTerms {
  cost: bigint;
  markup: bigint;
  platformFee: bigint;
  lateFee: bigint;
  depositBps: number;
  tenorSecs: number;
  acceptWindowSecs: number;
  fundingDeadline: number | null;
  security: bigint;
  securityBps: number;
}

export interface MockDeal {
  id: string;
  number: number;
  onchainId: number | null;
  importer: string | null;
  importerName: string;
  importerLegalName: string;
  importerStats: ImporterStats;
  supplier: { nameEn: string; nameZh: string | null; uscc: string | null; payoutAddress: string | null; confirmed: boolean };
  goodsSummary: string;
  route: { originPort: string; originCountry: string; destinationPort: string; destinationCountry: string; originLngLat: [number, number] | null; destinationLngLat: [number, number] | null };
  terms: MockTerms;
  state: DealStateName | null;
  stage: ImporterStage;
  funded: bigint;
  supplierPaid: bigint;
  listedAt: number;
  ownedAt: number;
  acceptedAt: number;
  dueAt: number;
  salePrice: bigint;
  principalRepaid: bigint;
  lateFeeDue: bigint;
  lateFeePaid: bigint;
  recovered: bigint;
  distributable: bigint;
  claimedShares: bigint;
  paidOut: bigint;
  holderCount: number;
  securityHeld: bigint;
  importerAtFault: boolean;
  extended: boolean;
  blFingerprint: string | null;
  blReportHash: string | null;
  decision: 'approve' | 'review' | 'reject' | null;
  riskScore: number | null;
  report: ReportResponse | null;
  documents: DocumentRecord[];
  promise: { text: string; textHash: string; listingFingerprint: string; security: bigint; securityBps: number; txHash: string | null; signedAt: string | null } | null;
  shipment: { carrier: string; blNumber: string; containers: string[]; status: string | null; documentId: string | null } | null;
  tracking: TrackingSnapshot | null;
  timeline: EventFeedItem[];
  payments: PaymentRecord[];
  shareToken: string | null;
  issuerPublicKey: string | null;
  listingTxHashes: Record<string, string>;
  holders: Map<string, bigint>;
  claimed: Map<string, { amount: bigint; txHash: string }>;
  investTx: Map<string, { txHash: string; at: string }>;
  audit: Array<{ id: string; actor: string; action: string; reason: string | null; at: string; txHash: string | null }>;
  incidents: Array<{ id: string; dealNumber: number | null; kind: string; detail: string; status: 'open' | 'resolved'; at: string }>;
  agentActions: Array<{ id: string; dealNumber: number | null; action: string; decision: string; reasoning: string; txHash: string | null; status: 'done' | 'skipped' | 'failed' | 'dry_run'; at: string }>;
  recoveries: Array<{ amount: bigint; from: string | null; note: string; txHash: string | null; at: string }>;
  recoveryNotes: Array<{ note: string; at: string; by: string }>;
  abort: { reason: string; importerAtFault: boolean; note: string; at: string; txHash: string | null } | null;
  extension: { requested: boolean; reason: string | null; decision: 'pending' | 'granted' | 'refused' | null; newDueAt: number | null } | null;
  blReleasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockUser {
  address: string;
  displayName: string | null;
  email: string | null;
  country: string | null;
  kycStatus: 'none' | 'pending' | 'approved' | 'rejected';
  investorApproved: boolean;
  approveTxHash: string | null;
  joinedVia: string | null;
  createdAt: string;
  importer: { legalName: string; country: string; registrationNumber: string; kybStatus: 'none' | 'pending' | 'approved' | 'rejected'; documents: DocumentRecord[]; faucetGrant: { amount: bigint; txHash: string } | null; submittedAt: string } | null;
  faucetTaken: boolean;
}

export interface World {
  deals: MockDeal[];
  users: Map<string, MockUser>;
  refunds: Map<string, bigint>;
  charity: Array<{ kind: 'late_fee' | 'dust' | 'sweep'; amount: bigint; txHash: string; dealNumber: number | null; at: string }>;
  jobs: Map<string, { id: string; kind: string; status: 'queued' | 'running' | 'done' | 'failed' | 'dead'; attempts: number; lastError: string | null; result: unknown; dealId: string }>;
  policy: Policy;
  demoImporter: string | null;
  demoInvestor: string | null;
  nextNumber: number;
  nextOnchain: number;
  walletsCreated: number;
  joinedDuringEvent: number;
  startedAt: string;
  agentAddress: string;
}

const T0 = nowSecs();
const ports = {
  yantian: { name: 'Shenzhen (Yantian)', country: 'CN', ll: [114.27, 22.57] as [number, number] },
  ningbo: { name: 'Ningbo', country: 'CN', ll: [121.85, 29.93] as [number, number] },
  nansha: { name: 'Guangzhou (Nansha)', country: 'CN', ll: [113.6, 22.76] as [number, number] },
  foshan: { name: 'Foshan via Shenzhen', country: 'CN', ll: [114.27, 22.57] as [number, number] },
  lagos: { name: 'Lagos (Apapa)', country: 'NG', ll: [3.36, 6.44] as [number, number] },
  mombasa: { name: 'Mombasa', country: 'KE', ll: [39.66, -4.06] as [number, number] },
};
const route = (a: keyof typeof ports, b: keyof typeof ports) => ({
  originPort: ports[a].name,
  originCountry: ports[a].country,
  destinationPort: ports[b].name,
  destinationCountry: ports[b].country,
  originLngLat: ports[a].ll,
  destinationLngLat: ports[b].ll,
});

const stats = (on_time: number, late = 0, defaulted = 0, open: bigint = 0n, total: bigint = 0n): ImporterStats => ({
  on_time,
  late,
  defaulted,
  total_repaid: total.toString(),
  open_exposure: open.toString(),
});

function doc(n: number, type: DocumentRecord['type'], filename: string, stage: DocumentRecord['stage'], pages = 1, at = T0 - 2 * DAY): DocumentRecord {
  return {
    id: uuid(900 + n),
    type,
    filename,
    mime: filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
    size: 180_000 + n * 7_321,
    sha256: sha256hex(`doc-${n}-${filename}`),
    pages,
    stage,
    status: 'uploaded',
    uploadedAt: iso(at),
    viewUrl: `/uploads/${uuid(900 + n)}`,
  };
}

export const ev = (d: Pick<MockDeal, 'number' | 'id'>, type: string, at: number, data: Record<string, unknown>, summary: string, ledger: number): EventFeedItem => ({
  txHash: fakeTx(),
  ledger,
  type,
  data,
  at: iso(at),
  dealNumber: d.number,
  dealId: d.id,
  summary,
});

export const pay = (kind: PaymentRecord['kind'], amount: bigint, at: number, txHash: string | null = fakeTx()): PaymentRecord => ({ kind, amount: amount.toString(), txHash, at: iso(at) });

// ------------------------------------------------------------------ reports

const f = <T>(value: T, evidence: string, page = 1, confidence = 0.97) => ({ value, evidence, page, confidence });
const party = (nameEn: string, nameZh: string | null, uscc: string | null, address: string, country: string) => ({
  name_en: f(nameEn, nameEn),
  name_zh: f(nameZh, nameZh ?? '', 1, nameZh ? 0.96 : 0.5),
  uscc: f(uscc, uscc ?? '', 1, uscc ? 0.98 : 0.5),
  address: f(address, address),
  country: f(country, country),
});

export function buildReport(d: MockDeal, kind: 'approve' | 'review' | 'reject', opts: { weightGapPct?: number; badContainer?: boolean } = {}): ReportResponse {
  const cost = Number(d.terms.cost / ONE);
  const supplierUscc = d.supplier.uscc ?? '91440300MA5F8KQX3W';
  const checks: Check[] = [
    { name: 'company_code_check_digit', status: 'pass', severity: 'critical', detail: `Unified Social Credit Code ${supplierUscc} has a valid check digit (ISO 7064 MOD 31-3).`, weight: 40, document: 'business_licence', field: 'uscc' },
    opts.badContainer
      ? { name: 'container_check_digit', status: 'fail', severity: 'critical', detail: 'Container CSQU3054384 fails the ISO 6346 check digit (expected 3, found 4).', weight: 40, document: 'packing_list', field: 'container_numbers', fix: 'Ask the supplier for a corrected packing list with the container number as printed on the box: CSQU3054383.' }
      : { name: 'container_check_digit', status: 'pass', severity: 'critical', detail: 'All container numbers pass the ISO 6346 check digit.', weight: 40, document: 'packing_list', field: 'container_numbers' },
    { name: 'invoice_arithmetic', status: 'pass', severity: 'high', detail: `Line totals sum to the invoice total of ${cost.toLocaleString('en-US')} USD within 0.01.`, weight: 25, document: 'invoice', field: 'total' },
    { name: 'dates', status: 'pass', severity: 'medium', detail: 'Invoice date is before today and within 60 days of the planned shipment.', weight: 10, document: 'invoice', field: 'invoice_date' },
    opts.weightGapPct && opts.weightGapPct > 2
      ? { name: 'weights', status: 'review', severity: 'medium', detail: `Packing list gross weight differs from the declared weight by ${opts.weightGapPct.toFixed(1)}% (2 to 5% needs a person).`, weight: 15, document: 'packing_list', field: 'total_gross_weight_kg', fix: 'Upload a packing list whose gross weight matches the invoice declaration, or explain the difference (pallets, packaging).' }
      : { name: 'weights', status: 'pass', severity: 'medium', detail: 'Gross weights agree within 2%.', weight: 15, document: 'packing_list', field: 'total_gross_weight_kg' },
    { name: 'quantities', status: 'pass', severity: 'high', detail: 'Quantities per item match between the invoice and the packing list.', weight: 20, document: 'packing_list', field: 'items' },
    { name: 'incoterms_hs_codes', status: 'pass', severity: 'low', detail: 'Incoterms FOB (2020 list); HS codes are 8 digits.', weight: 5, document: 'invoice', field: 'incoterms' },
    { name: 'supplier_equals_shipper', status: 'pass', severity: 'high', detail: `Seller on the invoice matches the licence holder ${d.supplier.nameEn}.`, weight: 20, document: 'invoice', field: 'seller' },
    { name: 'buyer_is_deal_entity', status: 'pass', severity: 'critical', detail: `Buyer is "${ENTITY_NAME}, deal ${d.number}" with the importer as notify party.`, weight: 30, document: 'invoice', field: 'buyer' },
    { name: 'goods_descriptions_match', status: 'pass', severity: 'medium', detail: 'English and Chinese descriptions describe the same goods.', weight: 10, document: 'invoice', field: 'line_items' },
    { name: 'halal_screen', status: 'pass', severity: 'critical', detail: 'Every line item is in a permitted category.', weight: 50, document: 'invoice', field: 'line_items' },
    { name: 'price_reference', status: 'pass', severity: 'medium', detail: 'Unit prices are within 0.8x to 1.3x of the reference range for this category.', weight: 15, document: 'invoice', field: 'unit_price' },
    { name: 'registry', status: 'pass', severity: 'critical', detail: 'GLEIF: entity ACTIVE, LEI ISSUED, Chinese legal name matches the licence (fixture labelled mock).', weight: 40, document: 'business_licence', field: 'name_zh' },
    { name: 'sanctions', status: 'pass', severity: 'critical', detail: 'No match above 0.7 for the supplier, the importer or the legal representative.', weight: 50 },
    { name: 'fingerprint_unique', status: 'pass', severity: 'critical', detail: 'This invoice has not been financed before (database and on-chain).', weight: 50, document: 'invoice', field: 'invoice_number' },
    { name: 'key_field_confidence', status: 'pass', severity: 'medium', detail: 'Every key field was read with confidence 0.8 or higher and has evidence.', weight: 10 },
  ];
  const decision = kind;
  const risk = computeRisk(checks);
  const invoiceNo = `PI-2026-${String(d.number).padStart(3, '0')}`;
  const extractedInvoice = {
    type: 'invoice' as const,
    invoice_number: f(invoiceNo, `Invoice No.: ${invoiceNo}`),
    invoice_date: f('2026-10-12', 'Date: 12 Oct 2026'),
    invoice_kind: f('proforma' as const, 'PROFORMA INVOICE'),
    seller: party(d.supplier.nameEn, d.supplier.nameZh, supplierUscc, 'Bao\'an District, Shenzhen', 'CN'),
    buyer: party(`${ENTITY_NAME}, deal ${d.number}`, null, null, 'Lisbon, Portugal', 'PT'),
    consignee: null,
    notify_party: f(d.importerLegalName, `Notify: ${d.importerLegalName}`),
    incoterms: f('FOB', 'FOB Shenzhen'),
    currency: f('USD', 'USD'),
    total: f(cost, `TOTAL: USD ${cost.toLocaleString('en-US')}`),
    line_items: [
      { description_en: f(d.goodsSummary, d.goodsSummary), description_zh: f(null, '', 1, 0.5), hs_code: f('39269099', '3926.90.99'), quantity: f(1, '1 lot'), unit: f('lot', 'lot'), unit_price: f(cost, String(cost)), line_total: f(cost, String(cost)) },
    ],
    port_of_loading: f(d.route.originPort, d.route.originPort),
    port_of_discharge: f(d.route.destinationPort, d.route.destinationPort),
    payment_terms: f(`${d.terms.depositBps / 100}% deposit, balance against B/L to order of ${ENTITY_NAME}`, 'Payment terms'),
    hidden_or_suspicious_text: [],
  };
  const report: VerificationReport = {
    version: '1.1',
    stage: 'listing',
    deal_ref: d.id,
    created_at: nowIso(),
    decision,
    risk_score: risk,
    checks,
    extracted: {
      invoice: extractedInvoice,
      packing_list: {
        type: 'packing_list',
        packing_list_number: f(`PL-${invoiceNo}`, `Packing list ${invoiceNo}`),
        date: f('2026-10-12', '12 Oct 2026'),
        invoice_number: f(invoiceNo, invoiceNo),
        seller: extractedInvoice.seller,
        buyer: extractedInvoice.buyer,
        items: [{ description_en: f(d.goodsSummary, d.goodsSummary), quantity: f(1, '1 lot'), packages: f(240, '240 CTNS'), gross_weight_kg: f(4860, '4,860 KGS'), net_weight_kg: f(4420, '4,420 KGS'), cbm: f(28.4, '28.4 CBM') }],
        total_packages: f(240, '240 CTNS'),
        total_gross_weight_kg: f(opts.weightGapPct ? Math.round(4860 * (1 + opts.weightGapPct / 100)) : 4860, 'TOTAL G.W.'),
        total_net_weight_kg: f(4420, 'TOTAL N.W.'),
        total_cbm: f(28.4, '28.4 CBM'),
        container_numbers: [f(opts.badContainer ? 'CSQU3054384' : 'MSKU9070323', 'Container No.')],
        hidden_or_suspicious_text: [],
      },
      business_licence: {
        type: 'business_licence',
        name_zh: f(d.supplier.nameZh ?? '深圳市某某科技有限公司', '名称'),
        name_en: f(d.supplier.nameEn, d.supplier.nameEn, 1, 0.9),
        uscc: f(supplierUscc, '统一社会信用代码'),
        legal_representative: f('Li Wei', '法定代表人 李伟'),
        company_type: f('Limited liability company', '有限责任公司'),
        registered_capital: f('CNY 5,000,000', '注册资本'),
        establishment_date: f('2014-03-18', '成立日期'),
        business_term: f('2014-03-18 to long term', '营业期限'),
        business_scope: f('Manufacture and export of electronic accessories', '经营范围'),
        address: f('Bao\'an District, Shenzhen', '住所'),
        registration_authority: f('Shenzhen Market Supervision Administration', '登记机关'),
        issue_date: f('2023-06-02', '发照日期'),
        hidden_or_suspicious_text: [],
      },
      bill_of_lading: null,
    },
    registry: { source: 'fixture', mode: 'mock', found: true, lei: '300300ABCDEF12345678', legal_name_zh: d.supplier.nameZh, legal_name_en: d.supplier.nameEn, entity_status: 'ACTIVE', lei_status: 'ISSUED', country: 'CN', name_match_zh: 'yes', name_match_en: 'yes', manual_check_url: 'https://www.gsxt.gov.cn' },
    sanctions: [],
    tracking: null,
    price: [{ line: d.goodsSummary, category: 'phone accessories', unit_price_usd: cost, reference_low_usd: cost * 0.7, reference_high_usd: cost * 1.4, ratio_to_mid: 0.95, fx: null, status: 'pass' }],
    halal: [{ line: d.goodsSummary, category: 'consumer goods', verdict: 'permitted', reason: 'Ordinary consumer goods, no prohibited material.' }],
    consistency: [
      { field: 'seller_vs_licence', match: 'yes', reason: 'Same legal name after normalising the company suffix.', evidence_a: d.supplier.nameEn, evidence_b: d.supplier.nameEn },
      { field: 'buyer_vs_deal_entity', match: 'yes', reason: `Buyer names ${ENTITY_NAME} and the deal number.`, evidence_a: `${ENTITY_NAME}, deal ${d.number}`, evidence_b: `deal ${d.number}` },
    ],
    listing_fingerprint: sha256hex(`fp-${d.id}`),
    shipment_fingerprint: null,
    document_hashes: d.documents.map((x) => ({ type: x.type, sha256: x.sha256 })),
    models: [{ stage: 'extract', provider: 'bedrock', model_id: 'qwen.qwen3-vl-235b-a22b', prompt_version: 'extract-v3', tokens_in: 18_240, tokens_out: 2_110, latency_ms: 14_200, cost_usd: 0.021 }],
    adapter_modes: { llm: 'mock', registry: 'mock', sanctions: 'mock', tracking: 'skipped', fx: 'mock' },
    fixtures_used: ['registry/demo-supplier.json'],
    timings_ms: { extract: 14_200, validate: 40, consistency: 3_900, decide: 5 },
    cost_usd: 0.021,
    injection_attempts: [],
    explanation:
      kind === 'approve'
        ? 'Everything checks out. The three documents agree with each other, the supplier is active in the registry, no party is on a sanctions list, and the price is in the normal range. Ops will review and list the deal.'
        : kind === 'review'
          ? 'One thing needs a person. The packing list gross weight is a few percent heavier than the invoice declaration. Upload a corrected packing list or tell us why (extra pallets or packaging usually explain it) and screening will run again.'
          : 'This deal cannot go ahead with these documents. One container number on the packing list does not pass the check digit, which means the number was typed wrong or the document was altered. The same files cannot be submitted again.',
  };
  const fixes = checks.filter((c) => c.fix).map((c) => ({ check: c.name, document: c.document ?? null, field: c.field ?? null, fix: c.fix! }));
  return {
    report,
    reportHash: sha256hex(JSON.stringify(report)),
    signature: `${sha256hex(`sig-${d.id}`)}${sha256hex(`sig2-${d.id}`)}`,
    verifierPublicKey: null,
    stage: 'listing',
    decision,
    riskScore: risk,
    explanation: report.explanation,
    rejectCategory: kind === 'reject' ? 'document_integrity' : null,
    fixes,
    createdAt: nowIso(),
  };
}

// ------------------------------------------------------------------ seed

function baseDeal(n: number, over: Partial<MockDeal> & { terms: MockTerms; goodsSummary: string; route: MockDeal['route'] }): MockDeal {
  const id = uuid(n);
  const d: MockDeal = {
    id,
    number: n,
    onchainId: null,
    importer: null,
    importerName: 'Amina Trading',
    importerLegalName: 'Amina Trading Ltd',
    importerStats: stats(0),
    supplier: { nameEn: 'Shenzhen Brightwave Technology Co., Ltd.', nameZh: '深圳市亮波科技有限公司', uscc: '91440300MA5F8KQX3W', payoutAddress: fakeG(`supplier-${n}`), confirmed: true },
    state: null,
    stage: 'draft',
    funded: 0n,
    supplierPaid: 0n,
    listedAt: 0,
    ownedAt: 0,
    acceptedAt: 0,
    dueAt: 0,
    salePrice: 0n,
    principalRepaid: 0n,
    lateFeeDue: 0n,
    lateFeePaid: 0n,
    recovered: 0n,
    distributable: 0n,
    claimedShares: 0n,
    paidOut: 0n,
    holderCount: 0,
    securityHeld: 0n,
    importerAtFault: false,
    extended: false,
    blFingerprint: null,
    blReportHash: null,
    decision: null,
    riskScore: null,
    report: null,
    documents: [doc(n * 10 + 1, 'invoice', `proforma-invoice-${n}.pdf`, 'listing', 2), doc(n * 10 + 2, 'packing_list', `packing-list-${n}.pdf`, 'listing', 1), doc(n * 10 + 3, 'business_licence', `business-licence-${n}.jpg`, 'listing', 1)],
    promise: null,
    shipment: null,
    tracking: null,
    timeline: [],
    payments: [],
    shareToken: null,
    issuerPublicKey: null,
    listingTxHashes: {},
    holders: new Map(),
    claimed: new Map(),
    investTx: new Map(),
    audit: [],
    incidents: [],
    agentActions: [],
    recoveries: [],
    recoveryNotes: [],
    abort: null,
    extension: null,
    blReleasedAt: null,
    createdAt: iso(T0 - 3 * DAY),
    updatedAt: nowIso(),
    ...over,
  };
  return d;
}

const terms = (cost: number, markup: number, fee: number, lateFee: number, tenorSecs: number, onTime: number, over: Partial<MockTerms> = {}): MockTerms => {
  const c = BigInt(cost) * ONE;
  const sec = requiredSecurity(c, onTime, SECURITY_CFG);
  const bps = Math.max(SECURITY_CFG.securityFloorBps, SECURITY_CFG.minSecurityBps - onTime * SECURITY_CFG.securityStepBps);
  return { cost: c, markup: BigInt(markup) * ONE, platformFee: BigInt(fee) * ONE, lateFee: BigInt(lateFee) * ONE, depositBps: 3000, tenorSecs, acceptWindowSecs: 7 * DAY, fundingDeadline: null, security: sec, securityBps: bps, ...over };
};

/** Marks a deal as promised and listed with a share token, timeline and payments. */
export function listDeal(d: MockDeal, at: number, ledger: number) {
  d.onchainId = d.number;
  d.state = 'Listed';
  d.stage = 'listed';
  d.listedAt = at;
  d.securityHeld = d.terms.security;
  d.decision = d.decision ?? 'approve';
  d.riskScore = d.riskScore ?? 92;
  d.report = d.report ?? buildReport(d, 'approve');
  d.shareToken = fakeC(`share-${d.number}`);
  d.issuerPublicKey = fakeG(`issuer-${d.number}`);
  d.listingTxHashes = { issuer_created: fakeTx(), flags_set: fakeTx(), sac_deployed: fakeTx(), admin_set: fakeTx(), issuer_locked: fakeTx(), list_deal: fakeTx() };
  const fp = sha256hex(`fp-${d.id}`);
  const text = renderPromiseText({
    importerName: d.importerLegalName,
    importerAddress: d.importer ?? fakeC(`importer-${d.number}`),
    entityName: ENTITY_NAME,
    dealNumber: d.number,
    goodsSummary: d.goodsSummary,
    supplierName: d.supplier.nameEn,
    cost: d.terms.cost,
    markup: d.terms.markup,
    security: d.terms.security,
    securityBps: d.terms.securityBps,
    tenorDays: Math.max(1, Math.round(d.terms.tenorSecs / DAY)),
    acceptWindowDays: Math.max(1, Math.round(d.terms.acceptWindowSecs / DAY)),
    tokenCode: 'qUSD',
    listingFingerprintHex: fp,
  });
  const promiseTx = fakeTx();
  d.promise = { text, textHash: sha256hex(text), listingFingerprint: fp, security: d.terms.security, securityBps: d.terms.securityBps, txHash: promiseTx, signedAt: iso(at - HOUR) };
  d.timeline.push(ev(d, 'promised', at - HOUR, { importer: d.importer, security: d.terms.security.toString() }, `Importer signed the purchase promise and locked a security deposit of ${Number(d.terms.security / ONE).toLocaleString('en-US')} test dollars`, ledger - 700));
  d.timeline[d.timeline.length - 1]!.txHash = promiseTx;
  d.payments.push(pay('security_locked', d.terms.security, at - HOUR, promiseTx));
  d.timeline.push(ev(d, 'deal_listed', at, { deal_id: d.number, cost: d.terms.cost.toString(), share_token: d.shareToken }, `Deal ${d.number} listed with the verifier's signature over its terms`, ledger));
  d.timeline[d.timeline.length - 1]!.txHash = d.listingTxHashes['list_deal']!;
  d.audit.push({ id: randomUuid(), actor: 'ops@qafila.dev', action: 'list_deal', reason: null, at: iso(at), txHash: d.listingTxHashes['list_deal']! });
}

export function investAt(d: MockDeal, holder: string, amount: bigint, at: number, ledger: number) {
  const tx = fakeTx();
  d.holders.set(holder, (d.holders.get(holder) ?? 0n) + amount);
  d.investTx.set(holder, { txHash: tx, at: iso(at) });
  d.funded += amount;
  d.holderCount = d.holders.size;
  const e = ev(d, 'invested', at, { investor: holder, amount: amount.toString() }, `${holder.slice(0, 4)}…${holder.slice(-4)} invested ${Number(amount / ONE).toLocaleString('en-US')} test dollars`, ledger);
  e.txHash = tx;
  d.timeline.push(e);
  if (d.funded >= d.terms.cost && d.state === 'Listed') {
    d.state = 'Funded';
    d.stage = 'funded';
    d.timeline.push(ev(d, 'funded', at, { deal_id: d.number, funded: d.funded.toString() }, `Deal ${d.number} fully funded`, ledger));
  }
}

export function payDeposit(d: MockDeal, at: number, ledger: number, by: 'agent' | 'ops' = 'agent') {
  const dep = (d.terms.cost * BigInt(d.terms.depositBps)) / 10000n;
  d.supplierPaid += dep;
  d.state = 'DepositPaid';
  d.stage = 'deposit_paid';
  const tx = fakeTx();
  d.payments.push(pay('supplier_deposit', dep, at, tx));
  const e = ev(d, 'deposit_paid', at, { deal_id: d.number, amount: dep.toString(), supplier: d.supplier.payoutAddress }, `Supplier deposit of ${Number(dep / ONE).toLocaleString('en-US')} test dollars paid (${d.terms.depositBps / 100}% of cost)`, ledger);
  e.txHash = tx;
  d.timeline.push(e);
  d.agentActions.push({ id: randomUuid(), dealNumber: d.number, action: 'pay_supplier_deposit', decision: by === 'agent' ? 'paid' : 'paid by ops', reasoning: 'Registry and sanctions checks passed, supplier payout address on record, no open incident.', txHash: tx, status: 'done', at: iso(at) });
}

export function mockTracking(d: MockDeal, status: 'Loaded' | 'Sailing' | 'Arrived' | 'Booked', at: number): TrackingSnapshot {
  const containers = d.shipment?.containers ?? ['MSKU9070323'];
  const vessel = 'MAERSK KENTUCKY';
  const codes = { Booked: 30, Loaded: 35, Sailing: 40, Arrived: 45 } as const;
  const events: TrackingSnapshot['events'] = [
    { at: iso(at - 6 * DAY), location: d.route.originPort, description: 'Empty container released to shipper', vessel: null, voyage: null, isActual: true },
    { at: iso(at - 4 * DAY), location: d.route.originPort, description: 'Gate in, full', vessel: null, voyage: null, isActual: true },
  ];
  if (status !== 'Booked') events.push({ at: iso(at - 3 * DAY), location: d.route.originPort, description: 'Loaded on board', vessel, voyage: '412E', isActual: true });
  if (status === 'Sailing' || status === 'Arrived') events.push({ at: iso(at - 3 * DAY + 6 * HOUR), location: d.route.originPort, description: 'Vessel departed', vessel, voyage: '412E', isActual: true });
  if (status === 'Arrived') events.push({ at: iso(at), location: d.route.destinationPort, description: 'Vessel arrived', vessel, voyage: '412E', isActual: true });
  events.push({ at: iso(at + 20 * DAY), location: d.route.destinationPort, description: 'Estimated arrival', vessel, voyage: '412E', isActual: false });
  return {
    mode: 'mock',
    statusCode: codes[status],
    status,
    vessel,
    imo: '9342499',
    pol: d.route.originPort,
    pod: d.route.destinationPort,
    departure: status === 'Booked' ? null : iso(at - 3 * DAY + 6 * HOUR),
    arrival: iso(at + 20 * DAY),
    containers,
    events,
    lastPolledAt: nowIso(),
  };
}

export function confirmShipment(d: MockDeal, at: number, ledger: number) {
  const balance = d.terms.cost - d.supplierPaid;
  d.supplierPaid += balance;
  d.state = 'Owned';
  d.stage = 'owned';
  d.ownedAt = at;
  d.blFingerprint = sha256hex(`bl-${d.id}`);
  d.blReportHash = sha256hex(`blr-${d.id}`);
  const tx = fakeTx();
  d.payments.push(pay('supplier_balance', balance, at, tx));
  const e = ev(d, 'shipment_confirmed', at, { deal_id: d.number, bl_fingerprint: d.blFingerprint, balance: balance.toString() }, `Agent confirmed shipment: ${d.tracking?.vessel ?? 'vessel'} loaded at ${d.route.originPort}; balance of ${Number(balance / ONE).toLocaleString('en-US')} test dollars paid to the supplier`, ledger);
  e.txHash = tx;
  d.timeline.push(e);
  d.agentActions.push({ id: randomUuid(), dealNumber: d.number, action: 'confirm_shipment', decision: 'confirmed', reasoning: `Container ${d.shipment?.containers[0] ?? 'MSKU9070323'} appears in carrier tracking; loading event at ${d.route.originPort} names ${d.tracking?.vessel ?? 'the B/L vessel'}; B/L is to the order of ${ENTITY_NAME}; shipment fingerprint unused.`, txHash: tx, status: 'done', at: iso(at) });
}

export function acceptSale(d: MockDeal, at: number, ledger: number) {
  d.salePrice = d.terms.cost + d.terms.markup;
  d.acceptedAt = at;
  d.dueAt = at + d.terms.tenorSecs;
  d.principalRepaid = d.securityHeld;
  const e = ev(d, 'murabaha_accepted', at, { deal_id: d.number, sale_price: d.salePrice.toString(), due_at: d.dueAt }, `Importer signed the sale at ${Number(d.salePrice / ONE).toLocaleString('en-US')} test dollars, due ${new Date(d.dueAt * 1000).toLocaleDateString('en-GB')}`, ledger);
  d.timeline.push(e);
  d.payments.push(pay('security_applied', d.securityHeld, at, e.txHash));
  d.timeline.push({ ...ev(d, 'security_applied', at, { amount: d.securityHeld.toString() }, `Security deposit of ${Number(d.securityHeld / ONE).toLocaleString('en-US')} test dollars counted as the first payment`, ledger), txHash: e.txHash });
  d.securityHeld = 0n;
  d.state = 'Sold';
  d.stage = 'sold';
}

export function makeWorld(): World {
  const now = T0;
  const L = 1_980_000;
  const deals: MockDeal[] = [];

  // 1. Venue deal: Listed, open for the QR join flow, funding deadline Mon 26 Oct 12:00 WET.
  const venueDeadline = Math.floor(Date.UTC(2026, 9, 26, 11, 0, 0) / 1000);
  const d1 = baseDeal(1, {
    goodsSummary: '4,000 phone cases and tempered-glass screen protectors',
    route: route('yantian', 'lagos'),
    terms: terms(2000, 160, 40, 20, 90 * DAY, 0, { fundingDeadline: venueDeadline > now ? venueDeadline : now + DAY }),
    importerName: 'Amina Trading',
    importerLegalName: 'Amina Trading Ltd',
    importerStats: stats(0),
  });
  listDeal(d1, now - 5 * HOUR, L - 3600);
  investAt(d1, fakeG('coinvest'), (d1.terms.cost * BigInt(COINVEST_BPS)) / 10000n, now - 5 * HOUR + 60, L - 3590);
  investAt(d1, fakeC('wallet-a'), 500n * ONE, now - 4 * HOUR, L - 2900);
  investAt(d1, fakeC('wallet-b'), 250n * ONE, now - 3 * HOUR, L - 2200);
  investAt(d1, fakeC('wallet-c'), 400n * ONE, now - 50 * 60, L - 600);
  deals.push(d1);

  // 2. Shipping deal: funded and waiting for its B/L (FLOWS 4 example amounts).
  const d2 = baseDeal(2, {
    goodsSummary: '120 solar panels, 550 W, with mounting rails',
    route: route('ningbo', 'mombasa'),
    terms: terms(10000, 800, 200, 50, 90 * DAY, 0, { fundingDeadline: now - DAY }),
    importerName: 'Kioko Solar Supplies',
    importerLegalName: 'Kioko Solar Supplies Ltd',
    importerStats: stats(0, 0, 0, 10_000n * ONE),
    supplier: { nameEn: 'Ningbo Sunpath New Energy Co., Ltd.', nameZh: '宁波阳路新能源有限公司', uscc: '91330200MA2H3X7Y1K', payoutAddress: fakeG('supplier-2'), confirmed: true },
  });
  listDeal(d2, now - 2 * DAY, L - 34_000);
  investAt(d2, fakeG('coinvest'), 500n * ONE, now - 2 * DAY + 60, L - 33_900);
  for (const [i, amt] of [2500, 1500, 2000, 1000, 1200, 1300].entries()) investAt(d2, fakeC(`wallet-${i}`), BigInt(amt) * ONE, now - 2 * DAY + (i + 1) * 3 * HOUR, L - 33_000 + i * 2000);
  payDeposit(d2, now - DAY, L - 17_000);
  deals.push(d2);

  // 3. Late deal: owned, 120-second tenor, ready for the importer to sign the sale.
  const d3 = baseDeal(3, {
    goodsSummary: '2,400 LED tube lights and drivers',
    route: route('nansha', 'lagos'),
    terms: terms(5000, 400, 100, 25, 120, 2, { fundingDeadline: now - 3 * DAY, acceptWindowSecs: 2 * HOUR }),
    importerName: 'Olu Lighting',
    importerLegalName: 'Olu Lighting Nigeria Ltd',
    importerStats: stats(2, 0, 0, 5_000n * ONE, 12_960n * ONE),
    supplier: { nameEn: 'Guangzhou Lumen Lighting Co., Ltd.', nameZh: '广州流明照明有限公司', uscc: '91440101MA59R2T8XQ', payoutAddress: fakeG('supplier-3'), confirmed: true },
  });
  listDeal(d3, now - 4 * DAY, L - 70_000);
  investAt(d3, fakeG('coinvest'), 250n * ONE, now - 4 * DAY + 60, L - 69_900);
  for (const [i, amt] of [1500, 1250, 1000, 1000].entries()) investAt(d3, fakeC(`wallet-${i + 3}`), BigInt(amt) * ONE, now - 4 * DAY + (i + 1) * 4 * HOUR, L - 69_000 + i * 2000);
  payDeposit(d3, now - 3 * DAY, L - 52_000);
  d3.shipment = { carrier: 'Maersk', blNumber: 'MAEU2260031845', containers: ['MSKU9070323'], status: 'Sailing', documentId: uuid(934) };
  d3.documents.push(doc(34, 'bill_of_lading', 'bill-of-lading-3.pdf', 'shipment', 2, now - 2 * DAY));
  d3.tracking = mockTracking(d3, 'Sailing', now - 2 * DAY);
  d3.timeline.push(ev(d3, 'bl_uploaded', now - 2 * DAY, { bl: 'MAEU2260031845' }, 'Bill of lading uploaded, carrier tracking started', L - 35_000));
  confirmShipment(d3, now - 10 * 60, L - 120);
  deals.push(d3);

  // 4. Repaid late: shows the charity path and a claimable position.
  const d4 = baseDeal(4, {
    goodsSummary: '800 cartons of ceramic floor tiles',
    route: route('foshan', 'mombasa'),
    terms: terms(6000, 480, 120, 30, 60 * DAY, 1, { fundingDeadline: now - 70 * DAY }),
    importerName: 'Kioko Solar Supplies',
    importerLegalName: 'Kioko Solar Supplies Ltd',
    importerStats: stats(0, 1, 0, 0n, 6_480n * ONE),
    supplier: { nameEn: 'Foshan Terra Ceramics Co., Ltd.', nameZh: '佛山市泰拉陶瓷有限公司', uscc: '91440600MA4WQ1B52F', payoutAddress: fakeG('supplier-4'), confirmed: true },
    createdAt: iso(now - 80 * DAY),
  });
  listDeal(d4, now - 75 * DAY, L - 1_300_000);
  investAt(d4, fakeG('coinvest'), 300n * ONE, now - 75 * DAY + 60, L - 1_299_900);
  for (const [i, amt] of [2000, 1700, 1000, 1000].entries()) investAt(d4, fakeC(`wallet-${i}`), BigInt(amt) * ONE, now - 74 * DAY + i * 5 * HOUR, L - 1_290_000 + i * 3000);
  payDeposit(d4, now - 73 * DAY, L - 1_260_000);
  d4.shipment = { carrier: 'CMA CGM', blNumber: 'CMAU7731120045', containers: ['CSQU3054383'], status: 'Discharged', documentId: uuid(944) };
  d4.documents.push(doc(44, 'bill_of_lading', 'bill-of-lading-4.pdf', 'shipment', 2, now - 70 * DAY));
  d4.tracking = { ...mockTracking(d4, 'Arrived', now - 40 * DAY), statusCode: 50, status: 'Discharged' };
  confirmShipment(d4, now - 68 * DAY, L - 1_175_000);
  acceptSale(d4, now - 67 * DAY, L - 1_158_000);
  d4.blReleasedAt = iso(now - 66 * DAY);
  d4.timeline.push(ev(d4, 'bl_released', now - 66 * DAY, {}, 'Bill of lading released to the importer', L - 1_140_000));
  {
    const r1 = 2000n * ONE;
    const t1 = fakeTx();
    d4.principalRepaid += r1;
    d4.payments.push(pay('repayment', r1, now - 30 * DAY, t1));
    d4.timeline.push({ ...ev(d4, 'repaid', now - 30 * DAY, { amount: r1.toString() }, `Importer repaid ${Number(r1 / ONE).toLocaleString('en-US')} test dollars`, L - 518_000), txHash: t1 });
    const r2 = d4.salePrice - d4.principalRepaid;
    const t2 = fakeTx();
    d4.principalRepaid += r2;
    d4.payments.push(pay('repayment', r2, now - 4 * DAY, t2));
    d4.timeline.push({ ...ev(d4, 'repaid', now - 4 * DAY, { amount: r2.toString(), late: true }, `Importer repaid the last ${Number(r2 / ONE).toLocaleString('en-US')} test dollars, 3 days late. Investors are paid in full; a late fee is due to charity`, L - 69_000), txHash: t2 });
    d4.lateFeeDue = d4.terms.lateFee;
    d4.distributable = d4.salePrice - d4.terms.platformFee;
    d4.state = 'Repaid';
    d4.stage = 'repaid';
    const t3 = fakeTx();
    d4.lateFeePaid = d4.terms.lateFee;
    d4.payments.push(pay('late_fee', d4.terms.lateFee, now - 4 * DAY + 600, t3));
    d4.timeline.push({ ...ev(d4, 'late_fee_to_charity', now - 4 * DAY + 600, { amount: d4.terms.lateFee.toString() }, `Late fee of ${Number(d4.terms.lateFee / ONE).toLocaleString('en-US')} test dollars paid and set aside for charity`, L - 68_900), txHash: t3 });
    const t4 = fakeTx();
    d4.payments.push(pay('sweep', d4.terms.lateFee, now - 4 * DAY + 900, t4));
    d4.timeline.push({ ...ev(d4, 'swept', now - 4 * DAY + 900, { to: 'charity', amount: d4.terms.lateFee.toString() }, 'Agent swept the late fee to the charity address', L - 68_850), txHash: t4 });
    const claimer = fakeC('wallet-1');
    const shares = d4.holders.get(claimer)!;
    const payout = (shares * d4.distributable) / d4.funded;
    const t5 = fakeTx();
    d4.claimed.set(claimer, { amount: payout, txHash: t5 });
    d4.claimedShares += shares;
    d4.paidOut += payout;
    d4.payments.push(pay('claim', payout, now - 3 * DAY, t5));
    d4.timeline.push({ ...ev(d4, 'claimed', now - 3 * DAY, { holder: claimer, amount: payout.toString() }, `Investor claimed ${Number(payout / ONE).toLocaleString('en-US')} test dollars`, L - 52_000), txHash: t5 });
  }
  deals.push(d4);

  // 5. Cancelled: funding not reached; security refunded and waiting under "Money to collect".
  const d5 = baseDeal(5, {
    goodsSummary: '60 motorcycle engines and spare-part kits',
    route: route('yantian', 'lagos'),
    terms: terms(3000, 240, 60, 15, 60 * DAY, 0, { fundingDeadline: now - 2 * HOUR }),
    importerName: 'Amina Trading',
    importerLegalName: 'Amina Trading Ltd',
    importerStats: stats(0),
    createdAt: iso(now - 9 * DAY),
  });
  listDeal(d5, now - 7 * DAY, L - 120_000);
  investAt(d5, fakeG('coinvest'), 150n * ONE, now - 7 * DAY + 60, L - 119_900);
  investAt(d5, fakeC('wallet-a'), 300n * ONE, now - 6 * DAY, L - 100_000);
  investAt(d5, fakeC('wallet-b'), 450n * ONE, now - 5 * DAY, L - 90_000);
  d5.state = 'Cancelled';
  d5.stage = 'cancelled';
  d5.distributable = d5.funded;
  {
    const t = fakeTx();
    d5.timeline.push({ ...ev(d5, 'cancelled', now - HOUR, { deal_id: 5 }, 'Funding deadline passed; deal cancelled, everyone gets 100% back', L - 720), txHash: t });
    d5.timeline.push({ ...ev(d5, 'refund_owed', now - HOUR, { importer: d5.importer, amount: d5.terms.security.toString() }, `Security deposit of ${Number(d5.terms.security / ONE).toLocaleString('en-US')} test dollars owed back to the importer`, L - 720), txHash: t });
  }
  deals.push(d5);

  // 6. In review: weights differ 3.2%, one fix to make (I-3).
  const d6 = baseDeal(6, {
    goodsSummary: '3,000 m of polyester fabric, 150 gsm, mixed colours',
    route: route('yantian', 'lagos'),
    terms: terms(4200, 336, 84, 20, 90 * DAY, 0),
    importerName: 'Amina Trading',
    importerLegalName: 'Amina Trading Ltd',
    importerStats: stats(0),
    supplier: { nameEn: 'Shaoxing Weave Textile Co., Ltd.', nameZh: '绍兴市织云纺织有限公司', uscc: '91330600MA28P4D7X3', payoutAddress: fakeG('supplier-6'), confirmed: false },
    stage: 'review',
    decision: 'review',
    createdAt: iso(now - DAY),
  });
  d6.report = buildReport(d6, 'review', { weightGapPct: 3.2 });
  d6.riskScore = d6.report.riskScore;
  deals.push(d6);

  // 7. Rejected: packet 04, container check digit.
  const d7 = baseDeal(7, {
    goodsSummary: '1,200 stainless-steel kitchen sets',
    route: route('ningbo', 'mombasa'),
    terms: terms(7800, 624, 156, 40, 90 * DAY, 0),
    importerName: 'Kioko Solar Supplies',
    importerLegalName: 'Kioko Solar Supplies Ltd',
    importerStats: stats(0),
    stage: 'rejected',
    decision: 'reject',
    createdAt: iso(now - 2 * DAY),
  });
  d7.report = buildReport(d7, 'reject', { badContainer: true });
  d7.riskScore = d7.report.riskScore;
  deals.push(d7);

  for (const d of deals) d.timeline.sort((a, b) => a.at.localeCompare(b.at));

  const charity: World['charity'] = [{ kind: 'late_fee', amount: d4.terms.lateFee, txHash: d4.payments.find((p) => p.kind === 'sweep')!.txHash!, dealNumber: 4, at: d4.payments.find((p) => p.kind === 'sweep')!.at }];

  return {
    deals,
    users: new Map(),
    refunds: new Map(),
    charity,
    jobs: new Map(),
    policy: {
      version: 3,
      categories: [
        { name: 'consumer electronics and accessories', verdict: 'permitted', note: '' },
        { name: 'textiles and garments', verdict: 'permitted', note: 'No silk for men is not a screening rule; all textiles permitted.' },
        { name: 'building materials', verdict: 'permitted', note: '' },
        { name: 'solar and energy equipment', verdict: 'permitted', note: '' },
        { name: 'motorcycle and vehicle parts', verdict: 'permitted', note: '' },
        { name: 'food and beverages', verdict: 'review', note: 'Permitted only with halal certification for meat; alcohol prohibited.' },
        { name: 'alcohol', verdict: 'prohibited', note: 'Any alcoholic drink or ethanol for drinking.' },
        { name: 'pork products', verdict: 'prohibited', note: '' },
        { name: 'tobacco and vapes', verdict: 'prohibited', note: 'Board ruling of 2 Oct 2026.' },
        { name: 'gambling equipment', verdict: 'prohibited', note: '' },
        { name: 'weapons', verdict: 'prohibited', note: '' },
        { name: 'cosmetics', verdict: 'review', note: 'Check for alcohol-based and animal-derived ingredients.' },
      ],
      thresholds: { priceRatioLow: 0.5, priceRatioHigh: 2, weightReviewPct: 2, weightRejectPct: 5, sanctionsReview: 0.7, sanctionsReject: 0.9, keyFieldMinConfidence: 0.8 },
      updatedBy: 'sharia-board@qafila.dev',
      updatedAt: iso(now - 20 * DAY),
    },
    demoImporter: null,
    demoInvestor: null,
    nextNumber: 8,
    nextOnchain: 6,
    walletsCreated: 41,
    joinedDuringEvent: 17,
    startedAt: nowIso(),
    agentAddress: fakeC('agent-smart-account'),
  };
}

export const PROMISE_VERSION = PROMISE_TEMPLATE_VERSION;
