//! Admin and configuration (PLAN 3.3.4). Admin functions work while paused.
use soroban_sdk::{Address, BytesN, Env};

use crate::{errors::Error, events::*, math::BPS, storage, types::*};

pub fn require_admin(env: &Env) -> Result<Address, Error> {
    let admin = storage::admin(env)?;
    admin.require_auth();
    Ok(admin)
}

/// `caller` must be the admin or the agent (PLAN 3.3.4, `caller` argument).
pub fn require_admin_or_agent(env: &Env, caller: &Address) -> Result<(), Error> {
    caller.require_auth();
    if *caller == storage::admin(env)? {
        return Ok(());
    }
    match storage::agent(env) {
        Some(agent) if agent == *caller => Ok(()),
        _ => Err(Error::NotAuthorized),
    }
}

pub fn require_not_paused(env: &Env) -> Result<(), Error> {
    if storage::paused(env) {
        Err(Error::Paused)
    } else {
        Ok(())
    }
}

pub fn validate_config(c: &Config) -> Result<(), Error> {
    let bps_ok = |v: u32| i128::from(v) <= BPS;
    if !bps_ok(c.max_markup_bps)
        || !bps_ok(c.max_deposit_bps)
        || !bps_ok(c.min_security_bps)
        || !bps_ok(c.security_step_bps)
        || !bps_ok(c.security_floor_bps)
        || c.security_floor_bps > c.min_security_bps
        || c.max_investors_per_deal == 0
        || c.base_importer_limit < 0
        || c.limit_step < 0
    {
        return Err(Error::InvalidTerms);
    }
    Ok(())
}

pub fn set_verifier(env: &Env, pk: BytesN<32>) -> Result<(), Error> {
    require_admin(env)?;
    storage::set_verifier(env, &pk);
    RoleSet {
        role: 4,
        address: None,
        key: Some(pk),
    }
    .publish(env);
    Ok(())
}

pub fn set_agent(env: &Env, agent: Address) -> Result<(), Error> {
    require_admin(env)?;
    storage::set_agent(env, &agent);
    RoleSet {
        role: 1,
        address: Some(agent),
        key: None,
    }
    .publish(env);
    Ok(())
}

pub fn set_config(env: &Env, config: Config) -> Result<(), Error> {
    require_admin(env)?;
    validate_config(&config)?;
    storage::set_config(env, &config);
    ConfigSet {
        max_markup_bps: config.max_markup_bps,
        max_deposit_bps: config.max_deposit_bps,
        min_security_bps: config.min_security_bps,
    }
    .publish(env);
    Ok(())
}

pub fn set_charity(env: &Env, charity: Address) -> Result<(), Error> {
    require_admin(env)?;
    storage::set_charity(env, &charity);
    RoleSet {
        role: 2,
        address: Some(charity),
        key: None,
    }
    .publish(env);
    Ok(())
}

pub fn set_treasury(env: &Env, treasury: Address) -> Result<(), Error> {
    require_admin(env)?;
    storage::set_treasury(env, &treasury);
    RoleSet {
        role: 3,
        address: Some(treasury),
        key: None,
    }
    .publish(env);
    Ok(())
}

pub fn set_investor(env: &Env, investor: Address, approved: bool) -> Result<(), Error> {
    require_admin(env)?;
    storage::set_investor(env, &investor, approved);
    InvestorSet { investor, approved }.publish(env);
    Ok(())
}

pub fn set_paused(env: &Env, paused: bool) -> Result<(), Error> {
    require_admin(env)?;
    if storage::paused(env) == paused {
        return Err(Error::InvalidState);
    }
    storage::set_paused(env, paused);
    PausedSet { paused }.publish(env);
    Ok(())
}

pub fn upgrade(env: &Env, wasm_hash: BytesN<32>) -> Result<(), Error> {
    require_admin(env)?;
    env.deployer()
        .update_current_contract(soroban_sdk::ContractExecutable::Wasm(wasm_hash.clone()));
    Upgraded { wasm_hash }.publish(env);
    Ok(())
}
