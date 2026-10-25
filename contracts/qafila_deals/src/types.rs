use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DealState {
    Listed,
    Funded,
    DepositPaid,
    Owned,
    Sold,
    Repaid,
    Cancelled,
    Defaulted,
    Liquidated,
    Closed,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaymentMode {
    Native,
    TrustlessWork,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub max_markup_bps: u32,
    pub max_deposit_bps: u32,
    pub max_investors_per_deal: u32,
    pub min_tenor_secs: u64,
    pub grace_secs: u64,
    pub base_importer_limit: i128,
    pub limit_step: i128,
    // v1.1 (docs/FLOWS.md section 8)
    pub min_security_bps: u32,
    pub security_step_bps: u32,
    pub security_floor_bps: u32,
    pub max_extension_secs: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DealTerms {
    pub importer: Address,
    pub supplier: Address,
    pub share_token: Address,
    pub payout_token: Address,
    pub cost: i128,
    pub deposit_bps: u32,
    pub markup: i128,
    pub platform_fee: i128,
    pub late_fee: i128,
    pub funding_deadline: u64,
    pub accept_window_secs: u64,
    pub tenor_secs: u64,
    pub listing_fingerprint: BytesN<32>,
    pub report_hash: BytesN<32>,
    pub promise_hash: BytesN<32>,
    pub halal_ok: bool,
    pub payment_mode: PaymentMode,
    /// Importer's security deposit (hamish jiddiyyah), locked at the promise. v1.1.
    pub security: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deal {
    pub id: u64,
    pub terms: DealTerms,
    pub state: DealState,
    pub listed_at: u64,
    pub funded: i128,
    pub supplier_paid: i128,
    pub owned_at: u64,
    pub bl_fingerprint: Option<BytesN<32>>,
    pub bl_report_hash: Option<BytesN<32>>,
    pub sale_price: i128,
    pub accepted_at: u64,
    pub due_at: u64,
    pub principal_repaid: i128,
    pub late_fee_due: i128,
    pub late_fee_paid: i128,
    pub recovered: i128,
    pub distributable: i128,
    pub claimed_shares: i128,
    pub paid_out: i128,
    pub holder_count: u32,
    // v1.1
    pub security: i128,
    pub importer_at_fault: bool,
    pub extended: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PromiseRecord {
    pub importer: Address,
    pub promise_hash: BytesN<32>,
    pub security: i128,
    pub at: u64,
    pub listed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImporterStats {
    pub on_time: u32,
    pub late: u32,
    pub defaulted: u32,
    pub total_repaid: i128,
    pub open_exposure: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Roles {
    pub admin: Address,
    pub agent: Option<Address>,
    pub verifier: BytesN<32>,
    pub charity: Address,
    pub treasury: Address,
    pub settlement: Address,
    pub paused: bool,
    pub next_deal_id: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Owed {
    pub charity: i128,
    pub treasury: i128,
    pub refunds: i128,
    pub promises_held: i128,
}

/// Attestation purposes (PLAN 3.3.6).
pub const PURPOSE_LIST: u32 = 1;
pub const PURPOSE_SHIPPED: u32 = 2;
pub const PURPOSE_REPORT: u32 = 10;

/// Storage keys (PLAN 3.3.2 plus FLOWS 8).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    // instance
    Admin,
    Agent,
    Verifier,
    Charity,
    Treasury,
    Settlement,
    Config,
    NextDealId,
    Paused,
    CharityOwed,
    TreasuryOwed,
    PromiseHeld,
    RefundsOwed,
    // persistent
    Deal(u64),
    ListingFp(BytesN<32>),
    BlFp(BytesN<32>),
    ShareToken(Address),
    Promise(BytesN<32>),
    Investor(Address),
    HolderAt(u64, u32),
    IsHolder(u64, Address),
    Importer(Address),
    DealBalance(u64),
    Refund(Address),
}
