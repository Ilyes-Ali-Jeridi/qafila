//! Spike contract (PLAN 3.2): one function that requires auth on a caller and
//! makes a SAC transfer. Tracks B and C run SP5 and SP6 against it.
#![no_std]
use soroban_sdk::{contract, contractimpl, token::TokenClient, Address, Env};

#[contract]
pub struct Probe;

#[contractimpl]
impl Probe {
    /// `caller` authorizes; `amount` of `token` moves from `caller` to `to`.
    pub fn probe(env: Env, caller: Address, token: Address, to: Address, amount: i128) -> i128 {
        caller.require_auth();
        TokenClient::new(&env, &token).transfer(&caller, &to, &amount);
        TokenClient::new(&env, &token).balance(&to)
    }
}
