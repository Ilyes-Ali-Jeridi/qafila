//! Storage access (PLAN 3.3.2 + FLOWS 8). Every persistent write extends the
//! entry's TTL; `extend_instance` runs at the top of every entry point.
use soroban_sdk::{Address, BytesN, Env};

use crate::{errors::Error, types::*};

pub const DAY_LEDGERS: u32 = 17_280;
/// Extend when fewer than 14 days remain, to about 30 days (PLAN 3.3.2).
pub const TTL_THRESHOLD: u32 = 14 * DAY_LEDGERS;
pub const TTL_EXTEND_TO: u32 = 30 * DAY_LEDGERS;

pub fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn put<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey, value: &V) {
    env.storage().persistent().set(key, value);
    bump(env, key);
}

// ------------------------------------------------------------------ instance

pub fn admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotAuthorized)
}

pub fn agent(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Agent)
}

pub fn set_agent(env: &Env, agent: &Address) {
    env.storage().instance().set(&DataKey::Agent, agent);
}

pub fn verifier(env: &Env) -> Result<BytesN<32>, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Verifier)
        .ok_or(Error::NotAuthorized)
}

pub fn set_verifier(env: &Env, pk: &BytesN<32>) {
    env.storage().instance().set(&DataKey::Verifier, pk);
}

pub fn charity(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Charity)
        .ok_or(Error::InvalidState)
}

pub fn set_charity(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::Charity, a);
}

pub fn treasury(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Treasury)
        .ok_or(Error::InvalidState)
}

pub fn set_treasury(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::Treasury, a);
}

pub fn settlement(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Settlement)
        .ok_or(Error::InvalidState)
}

pub fn config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::InvalidState)
}

pub fn set_config(env: &Env, c: &Config) {
    env.storage().instance().set(&DataKey::Config, c);
}

pub fn paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, p: bool) {
    env.storage().instance().set(&DataKey::Paused, &p);
}

pub fn next_deal_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextDealId)
        .unwrap_or(1)
}

pub fn set_next_deal_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::NextDealId, &id);
}

/// Instance i128 totals: CharityOwed, TreasuryOwed, PromiseHeld, RefundsOwed.
pub fn inst_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().instance().get(key).unwrap_or(0)
}

pub fn set_inst_i128(env: &Env, key: &DataKey, v: i128) {
    env.storage().instance().set(key, &v);
}

/// Checked `+= delta`; the total can never go negative.
pub fn add_inst_i128(env: &Env, key: &DataKey, delta: i128) -> Result<i128, Error> {
    let cur = inst_i128(env, key);
    let next = cur.checked_add(delta).ok_or(Error::Overflow)?;
    if next < 0 {
        return Err(Error::Overflow);
    }
    set_inst_i128(env, key, next);
    Ok(next)
}

// ---------------------------------------------------------------- persistent

pub fn get_deal(env: &Env, id: u64) -> Result<Deal, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Deal(id))
        .ok_or(Error::DealNotFound)
}

pub fn put_deal(env: &Env, deal: &Deal) {
    put(env, &DataKey::Deal(deal.id), deal);
}

pub fn deal_balance(env: &Env, id: u64) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::DealBalance(id))
        .unwrap_or(0)
}

/// Checked `DealBalance += delta`; a negative result is an accounting bug and
/// aborts the call with `Overflow`.
pub fn add_deal_balance(env: &Env, id: u64, delta: i128) -> Result<i128, Error> {
    let cur = deal_balance(env, id);
    let next = cur.checked_add(delta).ok_or(Error::Overflow)?;
    if next < 0 {
        return Err(Error::Overflow);
    }
    put(env, &DataKey::DealBalance(id), &next);
    Ok(next)
}

pub fn set_deal_balance(env: &Env, id: u64, v: i128) {
    put(env, &DataKey::DealBalance(id), &v);
}

pub fn has_listing_fp(env: &Env, fp: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::ListingFp(fp.clone()))
}

pub fn mark_listing_fp(env: &Env, fp: &BytesN<32>, deal_id: u64) {
    put(env, &DataKey::ListingFp(fp.clone()), &deal_id);
}

pub fn has_bl_fp(env: &Env, fp: &BytesN<32>) -> bool {
    env.storage().persistent().has(&DataKey::BlFp(fp.clone()))
}

pub fn mark_bl_fp(env: &Env, fp: &BytesN<32>, deal_id: u64) {
    put(env, &DataKey::BlFp(fp.clone()), &deal_id);
}

pub fn has_share_token(env: &Env, share: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::ShareToken(share.clone()))
}

pub fn mark_share_token(env: &Env, share: &Address, deal_id: u64) {
    put(env, &DataKey::ShareToken(share.clone()), &deal_id);
}

pub fn promise(env: &Env, fp: &BytesN<32>) -> Option<PromiseRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::Promise(fp.clone()))
}

pub fn set_promise(env: &Env, fp: &BytesN<32>, p: &PromiseRecord) {
    put(env, &DataKey::Promise(fp.clone()), p);
}

pub fn remove_promise(env: &Env, fp: &BytesN<32>) {
    env.storage()
        .persistent()
        .remove(&DataKey::Promise(fp.clone()));
}

pub fn is_investor(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Investor(addr.clone()))
        .unwrap_or(false)
}

pub fn set_investor(env: &Env, addr: &Address, approved: bool) {
    put(env, &DataKey::Investor(addr.clone()), &approved);
}

pub fn holder_at(env: &Env, deal_id: u64, idx: u32) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::HolderAt(deal_id, idx))
}

pub fn set_holder_at(env: &Env, deal_id: u64, idx: u32, holder: &Address) {
    put(env, &DataKey::HolderAt(deal_id, idx), holder);
}

pub fn is_holder(env: &Env, deal_id: u64, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::IsHolder(deal_id, addr.clone()))
        .unwrap_or(false)
}

pub fn set_is_holder(env: &Env, deal_id: u64, addr: &Address) {
    put(env, &DataKey::IsHolder(deal_id, addr.clone()), &true);
}

pub fn importer_stats(env: &Env, addr: &Address) -> ImporterStats {
    env.storage()
        .persistent()
        .get(&DataKey::Importer(addr.clone()))
        .unwrap_or(ImporterStats {
            on_time: 0,
            late: 0,
            defaulted: 0,
            total_repaid: 0,
            open_exposure: 0,
        })
}

pub fn set_importer_stats(env: &Env, addr: &Address, s: &ImporterStats) {
    put(env, &DataKey::Importer(addr.clone()), s);
}

pub fn refund_of(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Refund(addr.clone()))
        .unwrap_or(0)
}

pub fn set_refund(env: &Env, addr: &Address, v: i128) {
    put(env, &DataKey::Refund(addr.clone()), &v);
}
