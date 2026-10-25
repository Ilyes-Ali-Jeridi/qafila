//! Happy path, late repayment, partial repayments, rounding, extension, views.
use super::*;
use crate::{errors::Error, events::Promised};
use soroban_sdk::{testutils::Events as _, Event as _};

#[test]
fn happy_path_on_time_every_balance() {
    let w = World::new();
    let c = w.client();
    let (id, terms, inv) = w.owned(1);

    // Supplier received deposit 3,000 and balance 7,000.
    assert_eq!(w.balance(&w.supplier), COST);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Owned);
    assert_eq!(d.supplier_paid, COST);
    assert_eq!(d.funded, COST);
    assert_eq!(d.holder_count, 3);
    assert_eq!(w.deal_balance(id), 0);
    assert_eq!(d.security, SECURITY);
    w.assert_books_balance(&[id]);

    // Sale: price 10,800, security counts as the first 2,000.
    let price = c.accept_murabaha(&id);
    assert_eq!(price, COST + MARKUP);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Sold);
    assert_eq!(d.principal_repaid, SECURITY);
    assert_eq!(d.security, 0);
    assert_eq!(d.due_at, w.now() + TENOR);
    assert_eq!(w.deal_balance(id), SECURITY);
    w.assert_books_balance(&[id]);

    // Importer pays the other 8,800 on time.
    let rest = price - SECURITY;
    assert_eq!(rest, 8_800 * ONE);
    w.mint(&w.importer, rest);
    w.advance(TENOR - 10);
    let outstanding = c.repay(&id, &rest);
    assert_eq!(outstanding, 0);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Repaid);
    assert_eq!(d.late_fee_due, 0);
    assert_eq!(d.distributable, 10_600 * ONE);
    assert_eq!(c.owed().treasury, FEE);
    let stats = c.importer_stats(&w.importer);
    assert_eq!(stats.on_time, 1);
    assert_eq!(stats.late, 0);
    assert_eq!(stats.open_exposure, 0);
    assert_eq!(stats.total_repaid, price);
    assert_eq!(c.importer_limit(&w.importer), 210_000 * ONE);
    w.assert_books_balance(&[id]);

    // Treasury sweep.
    assert_eq!(c.sweep_treasury(), FEE);
    assert_eq!(w.balance(&w.treasury), FEE);
    assert_eq!(c.owed().treasury, 0);

    // Claims: 5,300 / 3,180 / 2,120 = 10,600.
    assert_eq!(c.quote_claim(&inv[0], &id), 5_300 * ONE);
    let total = w.claim_all(id, &inv);
    assert_eq!(total, 10_600 * ONE);
    assert_eq!(w.balance(&inv[0]), 5_300 * ONE);
    assert_eq!(w.balance(&inv[1]), 3_180 * ONE);
    assert_eq!(w.balance(&inv[2]), 2_120 * ONE);
    assert_eq!(w.share_balance(&terms.share_token, &inv[0]), 0);
    w.assert_share_supply(id);
    assert_eq!(c.try_claim(&inv[0], &id), Err(Ok(Error::NothingToClaim)));

    // Close: no dust.
    c.close_deal(&id);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Closed);
    assert_eq!(d.paid_out, d.distributable);
    assert_eq!(w.deal_balance(id), 0);
    assert_eq!(c.owed().charity, 0);
    assert_eq!(w.contract_balance(), 0);
    w.assert_books_balance(&[id]);
    assert_eq!(c.try_close_deal(&id), Err(Ok(Error::InvalidState)));
}

#[test]
fn promise_emits_event_and_locks_security() {
    let w = World::new();
    let fp = w.fp(1);
    w.promise(&fp, SECURITY);
    let expected = Promised {
        importer: w.importer.clone(),
        listing_fingerprint: fp.clone(),
        promise_hash: BytesN::from_array(&w.env, &[0xBB; 32]),
        security: SECURITY,
    };
    let events = w.env.events().all();
    assert!(events
        .events()
        .contains(&expected.to_xdr(&w.env, &w.contract)));
    assert_eq!(w.client().owed().promises_held, SECURITY);
    assert_eq!(w.contract_balance(), SECURITY);
    let p = w.client().get_promise(&fp).unwrap();
    assert_eq!(p.security, SECURITY);
    assert!(!p.listed);
    w.assert_books_balance(&[]);
}

#[test]
fn late_repayment_fee_to_charity_investors_not_waiting() {
    let w = World::new();
    let c = w.client();
    let (id, _terms, inv) = w.sold(2);
    let price = COST + MARKUP;
    w.mint(&w.importer, price);
    w.advance(TENOR + 1);
    c.repay(&id, &(price - SECURITY));
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Repaid);
    assert_eq!(d.late_fee_due, LATE_FEE);
    assert_eq!(d.late_fee_paid, 0);
    let stats = c.importer_stats(&w.importer);
    assert_eq!(stats.late, 1);
    assert_eq!(stats.on_time, 0);
    assert_eq!(c.importer_limit(&w.importer), 200_000 * ONE);

    // Investors are paid in full before the late fee is paid.
    assert_eq!(w.claim_all(id, &inv), 10_600 * ONE);

    // Late fee: over-payment rejected, partial allowed, goes to charity.
    assert_eq!(
        c.try_pay_late_fee(&id, &(LATE_FEE + 1)),
        Err(Ok(Error::ExceedsRemaining))
    );
    c.pay_late_fee(&id, &(LATE_FEE / 2));
    assert_eq!(c.owed().charity, LATE_FEE / 2);
    c.close_deal(&id);
    // Still payable after close.
    c.pay_late_fee(&id, &(LATE_FEE / 2));
    assert_eq!(c.owed().charity, LATE_FEE);
    assert_eq!(c.try_pay_late_fee(&id, &1), Err(Ok(Error::InvalidState)));
    assert_eq!(c.sweep_charity(), LATE_FEE);
    assert_eq!(w.balance(&w.charity), LATE_FEE);
    assert_eq!(c.owed().treasury, FEE);
    w.assert_books_balance(&[id]);
}

#[test]
fn partial_repayments_and_overpayment() {
    let w = World::new();
    let c = w.client();
    let (id, _t, _inv) = w.sold(3);
    let rest = 8_800 * ONE;
    w.mint(&w.importer, rest + ONE);
    assert_eq!(
        c.try_repay(&id, &(rest + 1)),
        Err(Ok(Error::ExceedsRemaining))
    );
    assert_eq!(c.try_repay(&id, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(c.repay(&id, &(3_000 * ONE)), 5_800 * ONE);
    assert_eq!(c.get_deal(&id).state, DealState::Sold);
    assert_eq!(c.repay(&id, &(5_000 * ONE)), 800 * ONE);
    assert_eq!(
        c.try_repay(&id, &(800 * ONE + 1)),
        Err(Ok(Error::ExceedsRemaining))
    );
    assert_eq!(c.repay(&id, &(800 * ONE)), 0);
    assert_eq!(c.get_deal(&id).state, DealState::Repaid);
    assert_eq!(c.try_repay(&id, &1), Err(Ok(Error::InvalidState)));
    w.assert_books_balance(&[id]);
}

#[test]
fn over_investment_and_funding_window() {
    let w = World::new();
    let c = w.client();
    let (id, _t) = w.list(4);
    let a = w.new_investor(20_000 * ONE);
    assert_eq!(
        c.try_invest(&a, &id, &(COST + 1)),
        Err(Ok(Error::ExceedsRemaining))
    );
    assert_eq!(c.try_invest(&a, &id, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(c.try_invest(&a, &id, &-5), Err(Ok(Error::InvalidAmount)));
    c.invest(&a, &id, &(9_000 * ONE));
    assert_eq!(
        c.try_invest(&a, &id, &(1_000 * ONE + 1)),
        Err(Ok(Error::ExceedsRemaining))
    );
    // Same investor again: no new holder slot.
    assert_eq!(c.invest(&a, &id, &(1_000 * ONE)), COST);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Funded);
    assert_eq!(d.holder_count, 1);
    assert_eq!(c.try_invest(&a, &id, &1), Err(Ok(Error::InvalidState)));
    w.assert_share_supply(id);

    let (id2, _t) = w.list(5);
    w.advance(FUNDING_WINDOW + 1);
    assert_eq!(c.try_invest(&a, &id2, &ONE), Err(Ok(Error::FundingClosed)));
}

#[test]
fn rounding_three_holders_dust_to_charity() {
    let w = World::new();
    let c = w.client();
    // Indivisible: cost 10,000 and 3 investors with 3,333.3333334 / 3,333.3333333 / 3,333.3333333.
    let (id, _t) = w.list(6);
    let x = 33_333_333_334i128;
    let y = 33_333_333_333i128;
    let a = w.new_investor(x);
    let b = w.new_investor(y);
    let d3 = w.new_investor(y);
    c.invest(&a, &id, &x);
    c.invest(&b, &id, &y);
    c.invest(&d3, &id, &y);
    assert_eq!(c.get_deal(&id).state, DealState::Funded);
    c.pay_supplier_deposit(&w.admin, &id);
    w.ship(id, 6);
    c.accept_murabaha(&id);
    w.mint(&w.importer, 8_800 * ONE);
    c.repay(&id, &(8_800 * ONE));
    let deal = c.get_deal(&id);
    assert_eq!(deal.distributable, 10_600 * ONE);
    let paid = w.claim_all(id, &[a, b, d3]);
    let deal = c.get_deal(&id);
    assert!(paid <= deal.distributable);
    assert!(deal.distributable - paid < i128::from(deal.holder_count));
    let dust = deal.distributable - paid;
    c.close_deal(&id);
    assert_eq!(c.owed().charity, dust);
    assert_eq!(w.deal_balance(id), 0);
    w.assert_books_balance(&[id]);
    c.sweep_charity();
    assert_eq!(w.balance(&w.charity), dust);
}

#[test]
fn extend_due_once_price_unchanged_not_late_not_on_time() {
    let w = World::new();
    let c = w.client();
    let (id, _t, _inv) = w.sold(7);
    let d = c.get_deal(&id);
    let due = d.due_at;
    assert_eq!(c.try_extend_due(&id, &due), Err(Ok(Error::InvalidDueDate)));
    assert_eq!(
        c.try_extend_due(&id, &(due + 601)),
        Err(Ok(Error::InvalidDueDate))
    );
    c.extend_due(&id, &(due + 600));
    let d = c.get_deal(&id);
    assert!(d.extended);
    assert_eq!(d.due_at, due + 600);
    assert_eq!(d.sale_price, COST + MARKUP);
    assert_eq!(
        c.try_extend_due(&id, &(due + 700)),
        Err(Ok(Error::AlreadyExtended))
    );
    // Paid after the old date but before the new one: not late, not on time.
    w.set_time(due + 300);
    w.mint(&w.importer, 8_800 * ONE);
    c.repay(&id, &(8_800 * ONE));
    let d = c.get_deal(&id);
    assert_eq!(d.late_fee_due, 0);
    assert_eq!(d.sale_price, COST + MARKUP);
    let s = c.importer_stats(&w.importer);
    assert_eq!((s.on_time, s.late), (0, 0));
    assert_eq!(s.total_repaid, COST + MARKUP);
}

#[test]
fn extend_due_then_late_after_new_date() {
    let w = World::new();
    let c = w.client();
    let (id, _t, _inv) = w.sold(8);
    let due = c.get_deal(&id).due_at;
    c.extend_due(&id, &(due + 600));
    w.set_time(due + 601);
    w.mint(&w.importer, 8_800 * ONE);
    c.repay(&id, &(8_800 * ONE));
    let d = c.get_deal(&id);
    assert_eq!(d.late_fee_due, LATE_FEE);
    assert_eq!(c.importer_stats(&w.importer).late, 1);
}

#[test]
fn accept_window_and_sale_price_fixed() {
    let w = World::new();
    let c = w.client();
    let (id, _t, _inv) = w.owned(9);
    w.advance(ACCEPT_WINDOW + 1);
    assert_eq!(
        c.try_accept_murabaha(&id),
        Err(Ok(Error::AcceptWindowClosed))
    );
    // Ops aborts with fault (importer let the window pass).
    c.abort_deal(&id, &true);
    assert_eq!(c.get_deal(&id).state, DealState::Defaulted);
}

#[test]
fn views_holders_quote_and_limits() {
    let w = World::new();
    let c = w.client();
    let (id, _t) = w.list(10);
    let inv = w.fund(id);
    let page = c.holders(&id, &0, &2);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap(), inv[0]);
    let page = c.holders(&id, &2, &50);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap(), inv[2]);
    assert_eq!(c.holders(&id, &3, &10).len(), 0);
    assert_eq!(c.try_holders(&id, &0, &51), Err(Ok(Error::InvalidAmount)));
    assert_eq!(c.try_holders(&999, &0, &1), Err(Ok(Error::DealNotFound)));
    assert_eq!(c.quote_claim(&inv[0], &id), 0); // not claimable yet
    assert_eq!(c.try_get_deal(&42), Err(Ok(Error::DealNotFound)));
    assert_eq!(c.required_security(&w.importer, &COST), SECURITY);
    assert_eq!(c.importer_limit(&w.importer), 200_000 * ONE);
    assert!(c.is_investor_approved(&inv[0]));
    c.revoke_investor(&inv[0]);
    assert!(!c.is_investor_approved(&inv[0]));
    w.assert_share_supply(id);
}

#[test]
fn importer_cannot_invest_in_own_deal_and_limit_enforced() {
    let mut cfg = config();
    cfg.base_importer_limit = 20_000 * ONE;
    let w = World::with_config(cfg);
    let c = w.client();
    let (id, _t) = w.list(11);
    c.approve_investor(&w.importer);
    w.mint(&w.importer, ONE);
    assert_eq!(
        c.try_invest(&w.importer, &id, &ONE),
        Err(Ok(Error::NotApprovedInvestor))
    );

    // Second deal of 10,000 fits the 20,000 limit; a third does not.
    let (_id2, _t) = w.list(12);
    let fp = w.fp(13);
    w.promise(&fp, SECURITY);
    let share = w.new_share();
    let terms = w.terms(&share, &fp);
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::LimitExceeded))
    );
    assert_eq!(c.importer_stats(&w.importer).open_exposure, 2 * COST);
}

#[test]
fn security_requirement_falls_with_on_time_deals() {
    let w = World::new();
    let c = w.client();
    // Two on-time deals: requirement goes 20% -> 17.5% -> 15%.
    for n in 1..=2u8 {
        let (id, _t, inv) = w.sold(n);
        w.mint(&w.importer, 8_800 * ONE);
        c.repay(&id, &(8_800 * ONE));
        w.claim_all(id, &inv);
        c.close_deal(&id);
    }
    assert_eq!(c.importer_stats(&w.importer).on_time, 2);
    assert_eq!(c.required_security(&w.importer, &COST), 1_500 * ONE);
    // Never below the 10% floor.
    let w2 = World::new();
    w2.env.as_contract(&w2.contract, || {
        storage::set_importer_stats(
            &w2.env,
            &w2.importer,
            &ImporterStats {
                on_time: 100,
                late: 0,
                defaulted: 0,
                total_repaid: 0,
                open_exposure: 0,
            },
        );
    });
    assert_eq!(
        w2.client().required_security(&w2.importer, &COST),
        1_000 * ONE
    );
    // Ceil on an odd cost.
    assert_eq!(w2.client().required_security(&w2.importer, &7), 1);
}

#[test]
fn listing_security_bounds() {
    let w = World::new();
    let c = w.client();
    // Below the requirement.
    let fp = w.fp(20);
    w.promise(&fp, SECURITY - 1);
    let share = w.new_share();
    let mut terms = w.terms(&share, &fp);
    terms.security = SECURITY - 1;
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::SecurityTooLow))
    );
    // Exactly at it passes.
    let fp = w.fp(21);
    w.promise(&fp, SECURITY);
    let share = w.new_share();
    let terms = w.terms(&share, &fp);
    c.list_deal(&terms, &w.sign_list(&terms));
    // At or above the cost fails.
    let fp = w.fp(22);
    w.promise(&fp, COST);
    let share = w.new_share();
    let mut terms = w.terms(&share, &fp);
    terms.security = COST;
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::SecurityTooHigh))
    );
}
