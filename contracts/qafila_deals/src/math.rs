//! Checked i128 arithmetic. Payouts round down; dust goes to charity at close.
use crate::{errors::Error, types::*};

pub const BPS: i128 = 10_000;

pub fn add(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_add(b).ok_or(Error::Overflow)
}

pub fn sub(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_sub(b).ok_or(Error::Overflow)
}

pub fn mul(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_mul(b).ok_or(Error::Overflow)
}

/// `floor(a * b / d)`, `d > 0`.
pub fn mul_div_floor(a: i128, b: i128, d: i128) -> Result<i128, Error> {
    if d <= 0 {
        return Err(Error::Overflow);
    }
    mul(a, b)?.checked_div(d).ok_or(Error::Overflow)
}

/// `floor(amount * bps / 10000)`.
pub fn bps_floor(amount: i128, bps: u32) -> Result<i128, Error> {
    mul_div_floor(amount, i128::from(bps), BPS)
}

/// `ceil(amount * bps / 10000)` for `amount >= 0`.
pub fn bps_ceil(amount: i128, bps: u32) -> Result<i128, Error> {
    if amount < 0 {
        return Err(Error::InvalidAmount);
    }
    let p = mul(amount, i128::from(bps))?;
    let q = p / BPS;
    if p % BPS != 0 {
        add(q, 1)
    } else {
        Ok(q)
    }
}

/// `max(security_floor_bps, min_security_bps - on_time * security_step_bps)`,
/// saturating (FLOWS 8).
pub fn security_bps(cfg: &Config, on_time: u32) -> u32 {
    let drop = on_time.saturating_mul(cfg.security_step_bps);
    let v = cfg.min_security_bps.saturating_sub(drop);
    if v < cfg.security_floor_bps {
        cfg.security_floor_bps
    } else {
        v
    }
}

/// `ceil(cost * security_bps / 10000)`; 0 for a non-positive cost.
pub fn required_security(cfg: &Config, on_time: u32, cost: i128) -> Result<i128, Error> {
    if cost <= 0 {
        return Ok(0);
    }
    bps_ceil(cost, security_bps(cfg, on_time))
}

/// Pro-rata payout, floored: `shares * distributable / funded`.
pub fn payout(shares: i128, distributable: i128, funded: i128) -> Result<i128, Error> {
    if funded <= 0 || shares <= 0 || distributable <= 0 {
        return Ok(0);
    }
    mul_div_floor(shares, distributable, funded)
}

/// `base_importer_limit + limit_step * on_time`, 0 after any default (PLAN 3.3.4).
pub fn importer_limit(cfg: &Config, stats: &ImporterStats) -> i128 {
    if stats.defaulted > 0 {
        return 0;
    }
    let growth = cfg
        .limit_step
        .checked_mul(i128::from(stats.on_time))
        .unwrap_or(i128::MAX);
    cfg.base_importer_limit
        .checked_add(growth)
        .unwrap_or(i128::MAX)
}

pub fn state_index(s: DealState) -> u32 {
    match s {
        DealState::Listed => 0,
        DealState::Funded => 1,
        DealState::DepositPaid => 2,
        DealState::Owned => 3,
        DealState::Sold => 4,
        DealState::Repaid => 5,
        DealState::Cancelled => 6,
        DealState::Defaulted => 7,
        DealState::Liquidated => 8,
        DealState::Closed => 9,
    }
}
