//! Every state change emits one of these (PLAN 3.3.4, FLOWS 8).
use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent]
pub struct Promised {
    #[topic]
    pub importer: Address,
    pub listing_fingerprint: BytesN<32>,
    pub promise_hash: BytesN<32>,
    pub security: i128,
}

#[contractevent]
pub struct PromiseWithdrawn {
    #[topic]
    pub importer: Address,
    pub listing_fingerprint: BytesN<32>,
    pub security: i128,
}

#[contractevent]
pub struct DealListed {
    #[topic]
    pub deal_id: u64,
    #[topic]
    pub importer: Address,
    pub cost: i128,
    pub markup: i128,
    pub security: i128,
    pub share_token: Address,
    pub funding_deadline: u64,
}

#[contractevent]
pub struct Invested {
    #[topic]
    pub deal_id: u64,
    #[topic]
    pub investor: Address,
    pub amount: i128,
    pub funded: i128,
}

#[contractevent]
pub struct Funded {
    #[topic]
    pub deal_id: u64,
    pub funded: i128,
}

#[contractevent]
pub struct Cancelled {
    #[topic]
    pub deal_id: u64,
    pub distributable: i128,
}

#[contractevent]
pub struct DepositPaid {
    #[topic]
    pub deal_id: u64,
    pub supplier: Address,
    pub amount: i128,
}

#[contractevent]
pub struct ShipmentConfirmed {
    #[topic]
    pub deal_id: u64,
    pub bl_fingerprint: BytesN<32>,
    pub bl_report_hash: BytesN<32>,
    pub balance_paid: i128,
}

#[contractevent]
pub struct MurabahaAccepted {
    #[topic]
    pub deal_id: u64,
    pub sale_price: i128,
    pub due_at: u64,
}

#[contractevent]
pub struct SecurityApplied {
    #[topic]
    pub deal_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct Repaid {
    #[topic]
    pub deal_id: u64,
    pub amount: i128,
    pub principal_repaid: i128,
    pub complete: bool,
    pub late: bool,
}

#[contractevent]
pub struct LateFeeToCharity {
    #[topic]
    pub deal_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct DueExtended {
    #[topic]
    pub deal_id: u64,
    pub old_due_at: u64,
    pub new_due_at: u64,
}

#[contractevent]
pub struct Aborted {
    #[topic]
    pub deal_id: u64,
    pub importer_at_fault: bool,
    pub from_state: u32,
}

#[contractevent]
pub struct Defaulted {
    #[topic]
    pub deal_id: u64,
}

#[contractevent]
pub struct Recovery {
    #[topic]
    pub deal_id: u64,
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
pub struct SecurityUsed {
    #[topic]
    pub deal_id: u64,
    pub used: i128,
    pub refunded: i128,
}

#[contractevent]
pub struct Liquidated {
    #[topic]
    pub deal_id: u64,
    pub distributable: i128,
}

#[contractevent]
pub struct RefundOwed {
    #[topic]
    pub importer: Address,
    pub deal_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct Refunded {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
pub struct Claimed {
    #[topic]
    pub deal_id: u64,
    #[topic]
    pub holder: Address,
    pub shares: i128,
    pub payout: i128,
}

#[contractevent]
pub struct Closed {
    #[topic]
    pub deal_id: u64,
    pub dust_to_charity: i128,
}

#[contractevent]
pub struct Swept {
    #[topic]
    pub to: Address,
    pub kind: u32, // 1 charity, 2 treasury
    pub amount: i128,
}

#[contractevent]
pub struct RoleSet {
    pub role: u32, // 1 agent, 2 charity, 3 treasury, 4 verifier
    pub address: Option<Address>,
    pub key: Option<BytesN<32>>,
}

#[contractevent]
pub struct ConfigSet {
    pub max_markup_bps: u32,
    pub max_deposit_bps: u32,
    pub min_security_bps: u32,
}

#[contractevent]
pub struct InvestorSet {
    #[topic]
    pub investor: Address,
    pub approved: bool,
}

#[contractevent]
pub struct PausedSet {
    pub paused: bool,
}

#[contractevent]
pub struct Upgraded {
    pub wasm_hash: BytesN<32>,
}
