//! Qafila deals: murabaha trade-finance lifecycle on Stellar.
//! Interface frozen at H0 (PLAN 3.3.4 + FLOWS 8); bodies implemented by Track A.
#![no_std]

pub mod admin;
pub mod attest;
pub mod deal;
pub mod errors;
pub mod events;
pub mod math;
pub mod share;
pub mod storage;
pub mod types;

use soroban_sdk::{
    contract, contractimpl, contractmeta, panic_with_error, Address, BytesN, Env, Vec,
};

pub use errors::Error;
pub use types::*;

contractmeta!(key = "binver", val = "0.1.0");
contractmeta!(key = "source_repo", val = "github:Ilyes-Ali-Jeridi/qafila");

#[contract]
pub struct QafilaDeals;

fn must<T>(env: &Env, r: Result<T, Error>) -> T {
    match r {
        Ok(v) => v,
        Err(e) => panic_with_error!(env, e),
    }
}

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
        must(&env, admin::validate_config(&config));
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
        storage::extend_instance(&env);
    }

    pub fn set_verifier(env: Env, pk: BytesN<32>) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::set_verifier(&env, pk)
    }
    pub fn set_agent(env: Env, agent: Address) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::set_agent(&env, agent)
    }
    pub fn set_config(env: Env, config: Config) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::set_config(&env, config)
    }
    pub fn set_charity(env: Env, charity: Address) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::set_charity(&env, charity)
    }
    pub fn set_treasury(env: Env, treasury: Address) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::set_treasury(&env, treasury)
    }
    pub fn approve_investor(env: Env, investor: Address) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::set_investor(&env, investor, true)
    }
    pub fn revoke_investor(env: Env, investor: Address) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::set_investor(&env, investor, false)
    }
    pub fn pause(env: Env) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::set_paused(&env, true)
    }
    pub fn unpause(env: Env) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::set_paused(&env, false)
    }
    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) -> Result<(), Error> {
        storage::extend_instance(&env);
        admin::upgrade(&env, wasm_hash)
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
        storage::extend_instance(&env);
        deal::promise_purchase(&env, importer, listing_fingerprint, promise_hash, security)
    }

    /// Returns the security deposit while the promise is not yet listed (v1.1).
    pub fn withdraw_promise(
        env: Env,
        importer: Address,
        listing_fingerprint: BytesN<32>,
    ) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::withdraw_promise(&env, importer, listing_fingerprint)
    }

    /// Admin lists a deal after the verifier signed the LIST attestation over `terms`.
    pub fn list_deal(env: Env, terms: DealTerms, sig: BytesN<64>) -> Result<u64, Error> {
        storage::extend_instance(&env);
        deal::list_deal(&env, terms, sig)
    }

    /// Returns the investor's share balance after the mint.
    pub fn invest(env: Env, investor: Address, deal_id: u64, amount: i128) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::invest(&env, investor, deal_id, amount)
    }

    pub fn cancel_unfunded(env: Env, deal_id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        deal::cancel_unfunded(&env, deal_id)
    }

    /// `caller` is admin or agent. Returns the deposit paid.
    pub fn pay_supplier_deposit(env: Env, caller: Address, deal_id: u64) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::pay_supplier_deposit(&env, caller, deal_id)
    }

    /// `caller` is admin or agent. Verifies the SHIPPED attestation. Returns the balance paid.
    pub fn confirm_shipment(
        env: Env,
        caller: Address,
        deal_id: u64,
        bl_fingerprint: BytesN<32>,
        bl_report_hash: BytesN<32>,
        sig: BytesN<64>,
    ) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::confirm_shipment(&env, caller, deal_id, bl_fingerprint, bl_report_hash, sig)
    }

    /// Returns the fixed sale price.
    pub fn accept_murabaha(env: Env, deal_id: u64) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::accept_murabaha(&env, deal_id)
    }

    /// Returns the amount still outstanding.
    pub fn repay(env: Env, deal_id: u64, amount: i128) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::repay(&env, deal_id, amount)
    }

    pub fn pay_late_fee(env: Env, deal_id: u64, amount: i128) -> Result<(), Error> {
        storage::extend_instance(&env);
        deal::pay_late_fee(&env, deal_id, amount)
    }

    /// One extension per deal, price unchanged (v1.1).
    pub fn extend_due(env: Env, deal_id: u64, new_due_at: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        deal::extend_due(&env, deal_id, new_due_at)
    }

    pub fn abort_deal(env: Env, deal_id: u64, importer_at_fault: bool) -> Result<(), Error> {
        storage::extend_instance(&env);
        deal::abort_deal(&env, deal_id, importer_at_fault)
    }

    pub fn mark_default(env: Env, deal_id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        deal::mark_default(&env, deal_id)
    }

    pub fn deposit_recovery(
        env: Env,
        deal_id: u64,
        from: Address,
        amount: i128,
    ) -> Result<(), Error> {
        storage::extend_instance(&env);
        deal::deposit_recovery(&env, deal_id, from, amount)
    }

    pub fn finalize_default(env: Env, deal_id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        deal::finalize_default(&env, deal_id)
    }

    /// Anyone may call; it pays `holder`. Returns the payout.
    pub fn claim(env: Env, holder: Address, deal_id: u64) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::claim(&env, holder, deal_id)
    }

    /// Anyone may call; it pays `addr` what is owed in refunds (v1.1).
    pub fn withdraw_refund(env: Env, addr: Address) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::withdraw_refund(&env, addr)
    }

    pub fn close_deal(env: Env, deal_id: u64) -> Result<(), Error> {
        storage::extend_instance(&env);
        deal::close_deal(&env, deal_id)
    }

    pub fn sweep_charity(env: Env) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::sweep(&env, 1)
    }

    pub fn sweep_treasury(env: Env) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::sweep(&env, 2)
    }

    // ---------------------------------------------------------------- views

    pub fn get_deal(env: Env, deal_id: u64) -> Result<Deal, Error> {
        storage::extend_instance(&env);
        storage::get_deal(&env, deal_id)
    }

    pub fn get_config(env: Env) -> Config {
        storage::extend_instance(&env);
        must(&env, storage::config(&env))
    }

    pub fn get_roles(env: Env) -> Roles {
        storage::extend_instance(&env);
        Roles {
            admin: must(&env, storage::admin(&env)),
            agent: storage::agent(&env),
            verifier: must(&env, storage::verifier(&env)),
            charity: must(&env, storage::charity(&env)),
            treasury: must(&env, storage::treasury(&env)),
            settlement: must(&env, storage::settlement(&env)),
            paused: storage::paused(&env),
            next_deal_id: storage::next_deal_id(&env),
        }
    }

    pub fn importer_stats(env: Env, importer: Address) -> ImporterStats {
        storage::extend_instance(&env);
        storage::importer_stats(&env, &importer)
    }

    /// `base_importer_limit + limit_step * on_time`, 0 if the importer ever defaulted.
    pub fn importer_limit(env: Env, importer: Address) -> i128 {
        storage::extend_instance(&env);
        let cfg = must(&env, storage::config(&env));
        math::importer_limit(&cfg, &storage::importer_stats(&env, &importer))
    }

    /// `ceil(cost * max(floor, min - on_time * step) / 10000)` (v1.1).
    pub fn required_security(env: Env, importer: Address, cost: i128) -> i128 {
        storage::extend_instance(&env);
        let cfg = must(&env, storage::config(&env));
        let stats = storage::importer_stats(&env, &importer);
        must(&env, math::required_security(&cfg, stats.on_time, cost))
    }

    pub fn is_investor_approved(env: Env, investor: Address) -> bool {
        storage::extend_instance(&env);
        storage::is_investor(&env, &investor)
    }

    pub fn get_promise(env: Env, listing_fingerprint: BytesN<32>) -> Option<PromiseRecord> {
        storage::extend_instance(&env);
        storage::promise(&env, &listing_fingerprint)
    }

    /// Bounded page of the holder index, `limit <= 50`.
    pub fn holders(env: Env, deal_id: u64, start: u32, limit: u32) -> Result<Vec<Address>, Error> {
        storage::extend_instance(&env);
        deal::holders(&env, deal_id, start, limit)
    }

    pub fn quote_claim(env: Env, holder: Address, deal_id: u64) -> Result<i128, Error> {
        storage::extend_instance(&env);
        deal::quote_claim(&env, holder, deal_id)
    }

    pub fn refund_of(env: Env, addr: Address) -> i128 {
        storage::extend_instance(&env);
        storage::refund_of(&env, &addr)
    }

    pub fn owed(env: Env) -> Owed {
        storage::extend_instance(&env);
        Owed {
            charity: storage::inst_i128(&env, &DataKey::CharityOwed),
            treasury: storage::inst_i128(&env, &DataKey::TreasuryOwed),
            refunds: storage::inst_i128(&env, &DataKey::RefundsOwed),
            promises_held: storage::inst_i128(&env, &DataKey::PromiseHeld),
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
        storage::extend_instance(&env);
        must(
            &env,
            attest::verify(&env, purpose, deal_id, &payload_hash, &sig),
        );
    }
}

#[cfg(test)]
mod test;
