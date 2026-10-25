//! SP6 target (PLAN 3.2): `ping(caller)` only requires the caller's auth, like the
//! agent-callable Qafila functions (`pay_supplier_deposit`, `confirm_shipment`).
#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct Ping;

#[contractimpl]
impl Ping {
    pub fn ping(env: Env, caller: Address) -> u64 {
        caller.require_auth();
        env.ledger().sequence() as u64
    }
}
