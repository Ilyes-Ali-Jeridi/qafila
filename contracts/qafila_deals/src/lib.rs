//! Qafila deals: murabaha trade-finance lifecycle on Stellar.
//! Interface frozen at H0 (PLAN 3.3.4 + FLOWS 8). Bodies are stubs until Track A lands.
#![no_std]
#![allow(unused_variables)] // ponytail: stub bodies; Track A removes this line

pub mod errors;
pub mod events;
pub mod types;

use soroban_sdk::{contract, contractimpl, contractmeta, Address, BytesN, Env, Vec};

pub use errors::Error;
pub use types::*;

contractmeta!(key = "binver", val = "0.1.0");
contractmeta!(key = "source_repo", val = "github:Ilyes-Ali-Jeridi/qafila");

#[contract]
pub struct QafilaDeals;

#[contractimpl]
impl QafilaDeals {
    // ---------------------------------------------------------------- admin

    pub fn __constructor(
        env: Env,
        admin: Address,
        verifier: BytesN<32>,
        charity: Address,
        treasury: Address,
        settlement: Address,
        config: Config,
    ) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        env.storage().instance().set(&DataKey::Charity, &charity);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage()
            .instance()
            .set(&DataKey::Settlement, &settlement);
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::NextDealId, &1u64);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::CharityOwed, &0i128);
        env.storage().instance().set(&DataKey::TreasuryOwed, &0i128);
        env.storage().instance().set(&DataKey::PromiseHeld, &0i128);
        env.storage().instance().set(&DataKey::RefundsOwed, &0i128);
    }

    pub fn set_verifier(env: Env, pk: BytesN<32>) -> Result<(), Error> {
        Err(Error::InvalidState)
    }
    pub fn set_agent(env: Env, agent: Address) -> Result<(), Error> {
        Err(Error::InvalidState)
    }
    pub fn set_config(env: Env, config: Config) -> Result<(), Error> {
        Err(Error::InvalidState)
    }
    pub fn set_charity(env: Env, charity: Address) -> Result<(), Error> {
        Err(Error::InvalidState)
    }
    pub fn set_treasury(env: Env, treasury: Address) -> Result<(), Error> {
        Err(Error::InvalidState)
    }
    pub fn approve_investor(env: Env, investor: Address) -> Result<(), Error> {
        Err(Error::InvalidState)
    }
    pub fn revoke_investor(env: Env, investor: Address) -> Result<(), Error> {
        Err(Error::InvalidState)
    }
    pub fn pause(env: Env) -> Result<(), Error> {
        Err(Error::InvalidState)
    }
    pub fn unpause(env: Env) -> Result<(), Error> {
        Err(Error::InvalidState)
    }
    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    // ------------------------------------------------------------ lifecycle

    /// Importer's binding purchase promise (wa'd). Locks `security` (v1.1).
    pub fn promise_purchase(
        env: Env,
        importer: Address,
        listing_fingerprint: BytesN<32>,
        promise_hash: BytesN<32>,
        security: i128,
    ) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    /// Returns the security deposit while the promise is not yet listed (v1.1).
    pub fn withdraw_promise(
        env: Env,
        importer: Address,
        listing_fingerprint: BytesN<32>,
    ) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    /// Admin lists a deal after the verifier signed the LIST attestation over `terms`.
    pub fn list_deal(env: Env, terms: DealTerms, sig: BytesN<64>) -> Result<u64, Error> {
        Err(Error::InvalidState)
    }

    pub fn invest(env: Env, investor: Address, deal_id: u64, amount: i128) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    pub fn cancel_unfunded(env: Env, deal_id: u64) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    /// `caller` is admin or agent.
    pub fn pay_supplier_deposit(env: Env, caller: Address, deal_id: u64) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    /// `caller` is admin or agent. Verifies the SHIPPED attestation.
    pub fn confirm_shipment(
        env: Env,
        caller: Address,
        deal_id: u64,
        bl_fingerprint: BytesN<32>,
        bl_report_hash: BytesN<32>,
        sig: BytesN<64>,
    ) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    pub fn accept_murabaha(env: Env, deal_id: u64) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    pub fn repay(env: Env, deal_id: u64, amount: i128) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    pub fn pay_late_fee(env: Env, deal_id: u64, amount: i128) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    /// One extension per deal, price unchanged (v1.1).
    pub fn extend_due(env: Env, deal_id: u64, new_due_at: u64) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    pub fn abort_deal(env: Env, deal_id: u64, importer_at_fault: bool) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    pub fn mark_default(env: Env, deal_id: u64) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    pub fn deposit_recovery(
        env: Env,
        deal_id: u64,
        from: Address,
        amount: i128,
    ) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    pub fn finalize_default(env: Env, deal_id: u64) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    /// Anyone may call; it pays `holder`.
    pub fn claim(env: Env, holder: Address, deal_id: u64) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    /// Anyone may call; it pays `addr` what is owed in refunds (v1.1).
    pub fn withdraw_refund(env: Env, addr: Address) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    pub fn close_deal(env: Env, deal_id: u64) -> Result<(), Error> {
        Err(Error::InvalidState)
    }

    pub fn sweep_charity(env: Env) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    pub fn sweep_treasury(env: Env) -> Result<i128, Error> {
        Err(Error::InvalidState)
    }

    // ---------------------------------------------------------------- views

    pub fn get_deal(env: Env, deal_id: u64) -> Result<Deal, Error> {
        Err(Error::DealNotFound)
    }

    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn get_roles(env: Env) -> Roles {
        Roles {
            admin: env.storage().instance().get(&DataKey::Admin).unwrap(),
            agent: env.storage().instance().get(&DataKey::Agent),
            verifier: env.storage().instance().get(&DataKey::Verifier).unwrap(),
            charity: env.storage().instance().get(&DataKey::Charity).unwrap(),
            treasury: env.storage().instance().get(&DataKey::Treasury).unwrap(),
            settlement: env.storage().instance().get(&DataKey::Settlement).unwrap(),
            paused: env
                .storage()
                .instance()
                .get(&DataKey::Paused)
                .unwrap_or(false),
            next_deal_id: env
                .storage()
                .instance()
                .get(&DataKey::NextDealId)
                .unwrap_or(1),
        }
    }

    pub fn importer_stats(env: Env, importer: Address) -> ImporterStats {
        env.storage()
            .persistent()
            .get(&DataKey::Importer(importer))
            .unwrap_or(ImporterStats {
                on_time: 0,
                late: 0,
                defaulted: 0,
                total_repaid: 0,
                open_exposure: 0,
            })
    }

    /// `base_importer_limit + limit_step * on_time`, 0 if the importer ever defaulted.
    pub fn importer_limit(env: Env, importer: Address) -> i128 {
        0
    }

    /// `ceil(cost * max(floor, min - on_time * step) / 10000)` (v1.1).
    pub fn required_security(env: Env, importer: Address, cost: i128) -> i128 {
        0
    }

    pub fn is_investor_approved(env: Env, investor: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Investor(investor))
            .unwrap_or(false)
    }

    pub fn get_promise(env: Env, listing_fingerprint: BytesN<32>) -> Option<PromiseRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Promise(listing_fingerprint))
    }

    /// Bounded page of the holder index, `limit <= 50`.
    pub fn holders(env: Env, deal_id: u64, start: u32, limit: u32) -> Result<Vec<Address>, Error> {
        Err(Error::DealNotFound)
    }

    pub fn quote_claim(env: Env, holder: Address, deal_id: u64) -> Result<i128, Error> {
        Err(Error::DealNotFound)
    }

    pub fn refund_of(env: Env, addr: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Refund(addr))
            .unwrap_or(0)
    }

    pub fn owed(env: Env) -> Owed {
        Owed {
            charity: env
                .storage()
                .instance()
                .get(&DataKey::CharityOwed)
                .unwrap_or(0),
            treasury: env
                .storage()
                .instance()
                .get(&DataKey::TreasuryOwed)
                .unwrap_or(0),
            refunds: env
                .storage()
                .instance()
                .get(&DataKey::RefundsOwed)
                .unwrap_or(0),
            promises_held: env
                .storage()
                .instance()
                .get(&DataKey::PromiseHeld)
                .unwrap_or(0),
        }
    }

    /// Succeeds silently or traps on an invalid signature (PLAN 3.3.6).
    /// Other contracts call this through `try_verify_attestation`.
    pub fn verify_attestation(
        env: Env,
        purpose: u32,
        deal_id: u64,
        payload_hash: BytesN<32>,
        sig: BytesN<64>,
    ) {
        panic!("not implemented")
    }
}

#[cfg(test)]
mod test;
