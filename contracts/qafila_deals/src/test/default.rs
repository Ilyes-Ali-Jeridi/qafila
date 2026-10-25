//! Default and abort paths with the FLOWS worked numbers:
//! supplier vanishes 9,000; promise broken 10,000; goods lost; sold default 7,500.
use super::*;
use crate::errors::Error;

#[test]
fn supplier_vanishes_deposit_covers_loss_holders_get_9000() {
    let w = World::new();
    let c = w.client();
    let (id, _t) = w.list(1);
    let inv = w.fund(id);
    c.pay_supplier_deposit(&w.agent, &id);
    assert_eq!(w.balance(&w.supplier), 3_000 * ONE);
    assert_eq!(w.deal_balance(id), 7_000 * ONE);
    c.abort_deal(&id, &true);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Defaulted);
    assert!(d.importer_at_fault);
    assert_eq!(d.security, SECURITY); // kept for finalize
    assert_eq!(c.refund_of(&w.importer), 0);
    assert_eq!(c.importer_stats(&w.importer).defaulted, 1);
    assert_eq!(c.importer_limit(&w.importer), 0);
    w.assert_books_balance(&[id]);
    c.finalize_default(&id);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Liquidated);
    assert_eq!(d.distributable, 9_000 * ONE);
    assert_eq!(d.security, 0);
    assert_eq!(c.refund_of(&w.importer), 0);
    assert_eq!(c.importer_stats(&w.importer).open_exposure, 0);
    assert_eq!(w.claim_all(id, &inv), 9_000 * ONE);
    assert_eq!(w.balance(&inv[0]), 4_500 * ONE);
    c.close_deal(&id);
    w.assert_books_balance(&[id]);
    assert_eq!(w.contract_balance(), 0);
}

#[test]
fn promise_broken_resale_9000_uses_1000_refunds_1000_holders_get_10000() {
    let w = World::new();
    let c = w.client();
    let (id, _t, inv) = w.owned(2);
    assert_eq!(w.deal_balance(id), 0);
    c.abort_deal(&id, &true);
    // Qafila resells the goods for 9,000 net.
    let buyer = Address::generate(&w.env);
    w.mint(&buyer, 9_000 * ONE);
    c.deposit_recovery(&id, &buyer, &(9_000 * ONE));
    assert_eq!(c.get_deal(&id).recovered, 9_000 * ONE);
    w.assert_books_balance(&[id]);
    c.finalize_default(&id);
    let d = c.get_deal(&id);
    assert_eq!(d.distributable, 10_000 * ONE);
    assert_eq!(d.security, 0);
    assert_eq!(c.refund_of(&w.importer), 1_000 * ONE);
    assert_eq!(w.claim_all(id, &inv), 10_000 * ONE); // principal back, no profit
    assert_eq!(c.withdraw_refund(&w.importer), 1_000 * ONE);
    c.close_deal(&id);
    w.assert_books_balance(&[id]);
    assert_eq!(w.contract_balance(), 0);
}

#[test]
fn goods_lost_not_at_fault_full_security_refund_at_abort() {
    let w = World::new();
    let c = w.client();
    let (id, _t, inv) = w.owned(3);
    c.abort_deal(&id, &false);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Defaulted);
    assert!(!d.importer_at_fault);
    assert_eq!(d.security, 0);
    assert_eq!(c.refund_of(&w.importer), SECURITY);
    assert_eq!(c.importer_stats(&w.importer).defaulted, 0);
    // Insurance pays 6,000 as a recovery (not capped: the deal was never sold).
    let insurer = Address::generate(&w.env);
    w.mint(&insurer, 6_000 * ONE);
    c.deposit_recovery(&id, &insurer, &(6_000 * ONE));
    c.finalize_default(&id);
    let d = c.get_deal(&id);
    assert_eq!(d.distributable, 6_000 * ONE);
    assert_eq!(w.claim_all(id, &inv), 6_000 * ONE);
    assert_eq!(c.withdraw_refund(&w.importer), SECURITY);
    c.close_deal(&id);
    assert_eq!(w.contract_balance(), 0);
}

#[test]
fn sold_default_holders_get_7500_recovery_capped() {
    let w = World::new();
    let c = w.client();
    let (id, _t, inv) = w.sold(4);
    w.mint(&w.importer, 3_000 * ONE);
    c.repay(&id, &(3_000 * ONE));
    let d = c.get_deal(&id);
    assert_eq!(d.principal_repaid, 5_000 * ONE);
    assert_eq!(c.try_mark_default(&id), Err(Ok(Error::DueNotPassed)));
    w.set_time(d.due_at + 60);
    assert_eq!(c.try_mark_default(&id), Err(Ok(Error::DueNotPassed)));
    w.set_time(d.due_at + 61);
    c.mark_default(&id);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Defaulted);
    assert_eq!(c.importer_stats(&w.importer).defaulted, 1);
    assert_eq!(c.importer_limit(&w.importer), 0);
    assert_eq!(c.try_repay(&id, &1), Err(Ok(Error::InvalidState)));

    let collector = Address::generate(&w.env);
    w.mint(&collector, 10_000 * ONE);
    // Outstanding is 5,800: more is rejected.
    assert_eq!(
        c.try_deposit_recovery(&id, &collector, &(5_800 * ONE + 1)),
        Err(Ok(Error::ExceedsRemaining))
    );
    assert_eq!(
        c.try_deposit_recovery(&id, &collector, &0),
        Err(Ok(Error::InvalidAmount))
    );
    c.deposit_recovery(&id, &collector, &(2_500 * ONE));
    assert_eq!(
        c.try_deposit_recovery(&id, &collector, &(3_300 * ONE + 1)),
        Err(Ok(Error::ExceedsRemaining))
    );
    w.assert_books_balance(&[id]);
    c.finalize_default(&id);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Liquidated);
    assert_eq!(d.distributable, 7_500 * ONE);
    assert_eq!(d.sale_price, COST + MARKUP);
    assert_eq!(c.owed().treasury, 0); // fee forfeited
    assert_eq!(c.importer_stats(&w.importer).open_exposure, 0);
    assert_eq!(w.claim_all(id, &inv), 7_500 * ONE);
    assert_eq!(w.balance(&inv[0]), 3_750 * ONE);
    c.close_deal(&id);
    assert_eq!(
        c.try_deposit_recovery(&id, &collector, &1),
        Err(Ok(Error::InvalidState))
    );
    w.assert_books_balance(&[id]);
    assert_eq!(w.contract_balance(), 0);
}

#[test]
fn abort_invalid_states() {
    let w = World::new();
    let c = w.client();
    let (id, _t, _inv) = w.sold(5);
    assert_eq!(c.try_abort_deal(&id, &true), Err(Ok(Error::InvalidState)));
    assert_eq!(c.try_finalize_default(&id), Err(Ok(Error::InvalidState)));
    let who = Address::generate(&w.env);
    assert_eq!(
        c.try_deposit_recovery(&id, &who, &1),
        Err(Ok(Error::InvalidState))
    );
    assert_eq!(c.try_mark_default(&999), Err(Ok(Error::DealNotFound)));
}

#[test]
fn every_terminal_state_has_zero_security_and_distributable_equals_balance() {
    let w = World::new();
    let c = w.client();
    // Repaid
    let (a, _t, _i) = w.sold(6);
    w.mint(&w.importer, 8_800 * ONE);
    c.repay(&a, &(8_800 * ONE));
    // Cancelled
    let (b, _t) = w.list(7);
    w.advance(FUNDING_WINDOW + 1);
    c.cancel_unfunded(&b);
    // Liquidated
    let (d, _t) = w.list(8);
    w.fund(d);
    c.pay_supplier_deposit(&w.admin, &d);
    c.abort_deal(&d, &true);
    c.finalize_default(&d);
    for id in [a, b, d] {
        let deal = c.get_deal(&id);
        assert_eq!(deal.security, 0, "invariant 15");
        assert_eq!(deal.distributable, w.deal_balance(id), "invariant 9");
    }
    w.assert_books_balance(&[a, b, d]);
}
