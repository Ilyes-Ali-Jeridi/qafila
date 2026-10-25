//! Checked arithmetic and the security / limit formulas.
use super::*;
use crate::{errors::Error, math};

#[test]
fn checked_ops() {
    assert_eq!(math::add(1, 2), Ok(3));
    assert_eq!(math::add(i128::MAX, 1), Err(Error::Overflow));
    assert_eq!(math::sub(i128::MIN, 1), Err(Error::Overflow));
    assert_eq!(math::mul(i128::MAX, 2), Err(Error::Overflow));
    assert_eq!(math::mul_div_floor(7, 3, 2), Ok(10));
    assert_eq!(math::mul_div_floor(7, 3, 0), Err(Error::Overflow));
    assert_eq!(math::bps_floor(10_000, 3000), Ok(3_000));
    assert_eq!(math::bps_floor(7, 3000), Ok(2));
    assert_eq!(math::bps_ceil(7, 3000), Ok(3));
    assert_eq!(math::bps_ceil(10_000, 2000), Ok(2_000));
    assert_eq!(math::bps_ceil(-1, 2000), Err(Error::InvalidAmount));
}

#[test]
fn security_bps_schedule() {
    let cfg = config();
    assert_eq!(math::security_bps(&cfg, 0), 2000);
    assert_eq!(math::security_bps(&cfg, 1), 1750);
    assert_eq!(math::security_bps(&cfg, 2), 1500);
    assert_eq!(math::security_bps(&cfg, 4), 1000);
    assert_eq!(math::security_bps(&cfg, 5), 1000);
    assert_eq!(math::security_bps(&cfg, u32::MAX), 1000);
    assert_eq!(math::required_security(&cfg, 0, COST), Ok(SECURITY));
    assert_eq!(math::required_security(&cfg, 0, 0), Ok(0));
    assert_eq!(math::required_security(&cfg, 0, -5), Ok(0));
    assert_eq!(math::required_security(&cfg, 0, 1), Ok(1));
}

#[test]
fn payout_floor_and_limits() {
    assert_eq!(math::payout(5_000, 10_600, 10_000), Ok(5_300));
    assert_eq!(math::payout(1, 10, 3), Ok(3));
    assert_eq!(math::payout(1, 10, 0), Ok(0));
    assert_eq!(math::payout(0, 10, 3), Ok(0));
    let cfg = config();
    let mut s = ImporterStats {
        on_time: 0,
        late: 0,
        defaulted: 0,
        total_repaid: 0,
        open_exposure: 0,
    };
    assert_eq!(math::importer_limit(&cfg, &s), 200_000 * ONE);
    s.on_time = 3;
    assert_eq!(math::importer_limit(&cfg, &s), 230_000 * ONE);
    s.defaulted = 1;
    assert_eq!(math::importer_limit(&cfg, &s), 0);
    assert_eq!(math::state_index(DealState::Listed), 0);
    assert_eq!(math::state_index(DealState::Closed), 9);
}

#[test]
fn deposit_floor_and_fee_math_through_the_contract() {
    let w = World::new();
    let c = w.client();
    // Cost 10,000.0000001 with 30%: deposit floors.
    let fp = w.fp(1);
    w.promise(&fp, SECURITY + 1);
    let mut terms = w.terms(&w.new_share(), &fp);
    terms.cost = COST + 1;
    terms.security = SECURITY + 1;
    let id = c.list_deal(&terms, &w.sign_list(&terms));
    let a = w.new_investor(COST + 1);
    c.invest(&a, &id, &(COST + 1));
    assert_eq!(c.pay_supplier_deposit(&w.admin, &id), 3_000 * ONE);
    assert_eq!(w.deal_balance(id), 7_000 * ONE + 1);
    w.assert_books_balance(&[id]);
}
