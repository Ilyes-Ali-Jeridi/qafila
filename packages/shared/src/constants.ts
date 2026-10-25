/** Shared constants. Contract id and network come from GET /config at runtime, never from here. */

export const DECIMALS = 7;
export const ONE = 10_000_000n; // 1.0000000 in i128 stroops

export const DEAL_STATES = [
  'Listed',
  'Funded',
  'DepositPaid',
  'Owned',
  'Sold',
  'Repaid',
  'Cancelled',
  'Defaulted',
  'Liquidated',
  'Closed',
] as const;
export type DealStateName = (typeof DEAL_STATES)[number];

export const PAYMENT_MODES = ['Native', 'TrustlessWork'] as const;

export const ATTEST_PURPOSE = { LIST: 1, SHIPPED: 2, REPORT: 10 } as const;
export const ATTEST_PREFIX = 'QAFILA-ATTEST-V1'; // 16 bytes ASCII

export const NETWORKS = {
  local: { passphrase: 'Standalone Network ; February 2017', expert: null },
  testnet: { passphrase: 'Test SDF Network ; September 2015', expert: 'https://stellar.expert/explorer/testnet' },
  mainnet: { passphrase: 'Public Global Stellar Network ; September 2015', expert: 'https://stellar.expert/explorer/public' },
} as const;
export type NetworkName = keyof typeof NETWORKS;

export const DOCUMENT_TYPES = ['invoice', 'packing_list', 'business_licence', 'bill_of_lading', 'kyb'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DECISIONS = ['approve', 'review', 'reject'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Abort reasons (FLOWS O-5). `atFault` is the default; a change needs a note. */
export const ABORT_REASONS = {
  red_flag_before_payment: { label: 'Red flag before any payment', atFault: false },
  supplier_did_not_ship: { label: 'Supplier did not ship', atFault: true },
  bl_mismatch_not_fixed: { label: 'Bill of lading mismatch not fixed', atFault: true },
  importer_refused: { label: 'Importer refused or let the accept window pass', atFault: true },
  goods_lost_or_damaged: { label: 'Goods lost or damaged', atFault: false },
  force_majeure: { label: 'Force majeure', atFault: false },
  other: { label: 'Other', atFault: false },
} as const;
export type AbortReason = keyof typeof ABORT_REASONS;

/** ShipsGo status codes (PLAN 5.4). */
export const SHIPSGO_STATUS = { Booked: 30, Loaded: 35, Sailing: 40, Arrived: 45, Discharged: 50, Untracked: 60 } as const;

export const INCOTERMS_2020 = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'] as const;

export const FEATURE_FLAGS = [
  'FF_X402',
  'FF_TRUSTLESS_WORK',
  'FF_REFLECTOR',
  'FF_TRADE_PASSPORT',
  'FF_TRADE_FILE',
  'FF_QR_JOIN',
  'FF_USDT0_SWAP',
  'FF_ANCHOR',
  'FF_I18N',
  'FF_AIS',
  'FF_SUPPLIER_CONFIRM',
  'FF_EXTENSIONS',
  'FF_COINVEST',
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
