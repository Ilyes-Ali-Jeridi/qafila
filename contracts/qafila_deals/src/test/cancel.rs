//! Cancel path, aborts, promise lifecycle, refunds (FLOWS 8).
use super::*;
use crate::errors::Error;

#[test]
fn cancel_unfunded_refunds_investors_and_security() {
    let w = World::new();
    let c = w.client();
    let (id, _t) = w.list(1);
    let a = w.new_investor(4_000 * ONE);
    c.invest(&a, &id, &(4_000 * ONE));
    assert_eq!(
        c.try_cancel_unfunded(&id),
        Err(Ok(Error::DeadlineNotPassed))
    );
    w.advance(FUNDING_WINDOW + 1);
    c.cancel_unfunded(&id);
    let d = c.get_deal(&id);
    assert_eq!(d.state, DealState::Cancelled);
    assert_eq!(d.distributable, 4_000 * ONE);
    assert_eq!(d.security, 0);
    assert_eq!(c.refund_of(&w.importer), SECURITY);
    assert_eq!(c.owed().refunds, SECURITY);
    assert_eq!(c.importer_stats(&w.importer).open_exposure, 0);
    w.assert_books_balance(&[id]);
    // Investor gets 100% back, importer withdraws the security (anyone may trigger).
    assert_eq!(c.claim(&a, &id), 4_000 * ONE);
    assert_eq!(w.balance(&a), 4_000 * ONE);
    assert_eq!(c.withdraw_refund(&w.importer), SECURITY);
    assert_eq!(w.balance(&w.importer), SECURITY);
    assert_eq!(
        c.try_withdraw_refund(&w.importer),
        Err(Ok(Error::NothingToRefund))
    );
    c.close_deal(&id);
    assert_eq!(w.contract_balance(), 0);
    w.assert_books_balance(&[id]);
    assert_eq!(c.try_cancel_unfunded(&id), Err(Ok(Error::InvalidState)));
}

#[test]
fn abort_from_listed_and_funded_full_refund() {
    let w = World::new();
    let c = w.client();
    // Listed with no investor: abort, close at once.
    let (id, _t) = w.list(2);
    c.abort_deal(&id, &false);
    assert_eq!(c.get_deal(&id).state, DealState::Cancelled);
    assert_eq!(c.refund_of(&w.importer), SECURITY);
    c.close_deal(&id);
    assert_eq!(c.get_deal(&id).state, DealState::Closed);
    c.withdraw_refund(&w.importer);

    // Funded: everyone gets 100% back.
    let (id2, _t) = w.list(3);
    let inv = w.fund(id2);
    c.abort_deal(&id2, &true); // at-fault flag is irrelevant before any payment
    let d = c.get_deal(&id2);
    assert_eq!(d.state, DealState::Cancelled);
    assert_eq!(d.distributable, COST);
    assert_eq!(d.security, 0);
    assert_eq!(c.importer_stats(&w.importer).defaulted, 0);
    assert_eq!(w.claim_all(id2, &inv), COST);
    assert_eq!(c.withdraw_refund(&w.importer), SECURITY);
    c.close_deal(&id2);
    w.assert_books_balance(&[id, id2]);
    assert_eq!(w.contract_balance(), 0);
}

#[test]
fn withdraw_refund_pays_anyone_named_and_only_the_importer_is_credited() {
    let w = World::new();
    let c = w.client();
    let (id, _t) = w.list(4);
    c.abort_deal(&id, &false);
    let stranger = Address::generate(&w.env);
    assert_eq!(c.refund_of(&stranger), 0);
    assert_eq!(
        c.try_withdraw_refund(&stranger),
        Err(Ok(Error::NothingToRefund))
    );
    // A stranger triggers the importer's refund; the money still goes to the importer.
    let before = w.balance(&w.importer);
    assert_eq!(c.withdraw_refund(&w.importer), SECURITY);
    assert_eq!(w.balance(&w.importer) - before, SECURITY);
    assert_eq!(w.balance(&stranger), 0);
}

#[test]
fn promise_rules() {
    let w = World::new();
    let c = w.client();
    let fp = w.fp(5);
    let hash = BytesN::from_array(&w.env, &[0xBB; 32]);
    w.mint(&w.importer, 10 * SECURITY);
    assert_eq!(
        c.try_promise_purchase(&w.importer, &fp, &hash, &0),
        Err(Ok(Error::InvalidAmount))
    );
    c.promise_purchase(&w.importer, &fp, &hash, &SECURITY);
    // A second promise on the same fingerprint fails.
    assert_eq!(
        c.try_promise_purchase(&w.importer, &fp, &hash, &SECURITY),
        Err(Ok(Error::PromiseExists))
    );
    // Withdraw before listing returns it.
    assert_eq!(c.withdraw_promise(&w.importer, &fp), SECURITY);
    assert_eq!(c.owed().promises_held, 0);
    assert!(c.get_promise(&fp).is_none());
    assert_eq!(
        c.try_withdraw_promise(&w.importer, &fp),
        Err(Ok(Error::NoPromise))
    );
    // Promise again, list, then withdraw fails and a new promise on it fails.
    c.promise_purchase(&w.importer, &fp, &hash, &SECURITY);
    let share = w.new_share();
    let terms = w.terms(&share, &fp);
    c.list_deal(&terms, &w.sign_list(&terms));
    assert_eq!(
        c.try_withdraw_promise(&w.importer, &fp),
        Err(Ok(Error::PromiseListed))
    );
    assert_eq!(
        c.try_promise_purchase(&w.importer, &fp, &hash, &SECURITY),
        Err(Ok(Error::PromiseListed))
    );
    assert!(c.get_promise(&fp).unwrap().listed);
    // Only the promising importer may withdraw an unlisted promise.
    let fp2 = w.fp(6);
    c.promise_purchase(&w.importer, &fp2, &hash, &SECURITY);
    let other = Address::generate(&w.env);
    assert_eq!(
        c.try_withdraw_promise(&other, &fp2),
        Err(Ok(Error::NotAuthorized))
    );
    w.assert_books_balance(&[1]);
}

#[test]
fn promise_while_in_default_fails() {
    let w = World::new();
    let c = w.client();
    let (id, _t, _inv) = w.sold(7);
    w.advance(TENOR + 61);
    c.mark_default(&id);
    assert_eq!(c.importer_limit(&w.importer), 0);
    let fp = w.fp(8);
    w.mint(&w.importer, SECURITY);
    assert_eq!(
        c.try_promise_purchase(&w.importer, &fp, &w.fp(0xBB), &SECURITY),
        Err(Ok(Error::ImporterInDefault))
    );
}

#[test]
fn listing_requires_matching_promise() {
    let w = World::new();
    let c = w.client();
    let fp = w.fp(9);
    let share = w.new_share();
    let terms = w.terms(&share, &fp);
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::NoPromise))
    );

    // Promise by a different importer.
    let other = Address::generate(&w.env);
    w.mint(&other, SECURITY);
    c.promise_purchase(&other, &fp, &terms.promise_hash, &SECURITY);
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::PromiseMismatch))
    );

    // Different hash.
    let fp2 = w.fp(10);
    w.mint(&w.importer, SECURITY);
    c.promise_purchase(&w.importer, &fp2, &w.fp(0x99), &SECURITY);
    let terms2 = w.terms(&w.new_share(), &fp2);
    assert_eq!(
        c.try_list_deal(&terms2, &w.sign_list(&terms2)),
        Err(Ok(Error::PromiseMismatch))
    );

    // Different security amount.
    let fp3 = w.fp(11);
    w.mint(&w.importer, SECURITY + ONE);
    c.promise_purchase(&w.importer, &fp3, &terms.promise_hash, &(SECURITY + ONE));
    let terms3 = w.terms(&w.new_share(), &fp3);
    assert_eq!(
        c.try_list_deal(&terms3, &w.sign_list(&terms3)),
        Err(Ok(Error::PromiseMismatch))
    );
}

#[test]
fn uniqueness_of_fingerprints_and_share_token() {
    let w = World::new();
    let c = w.client();
    let (id, terms) = w.list(12);
    // Same listing fingerprint again.
    let mut t2 = w.terms(&w.new_share(), &terms.listing_fingerprint);
    t2.security = SECURITY;
    assert_eq!(
        c.try_list_deal(&t2, &w.sign_list(&t2)),
        Err(Ok(Error::ListingFingerprintUsed))
    );
    // Same share token on a new fingerprint.
    let fp = w.fp(13);
    w.promise(&fp, SECURITY);
    let t3 = w.terms(&terms.share_token, &fp);
    assert_eq!(
        c.try_list_deal(&t3, &w.sign_list(&t3)),
        Err(Ok(Error::ShareTokenUsed))
    );

    // B/L fingerprint reuse across deals.
    w.fund(id);
    c.pay_supplier_deposit(&w.agent, &id);
    w.ship(id, 12);
    let (id2, _t) = w.list(14);
    w.fund(id2);
    c.pay_supplier_deposit(&w.agent, &id2);
    let bl_fp = w.fp(0xC0 + 12);
    let bl_report = w.fp(0xD0 + 14);
    let sig = w.sign_shipped(id2, &bl_fp, &bl_report);
    assert_eq!(
        c.try_confirm_shipment(&w.agent, &id2, &bl_fp, &bl_report, &sig),
        Err(Ok(Error::BlFingerprintUsed))
    );
}

#[test]
fn term_validation_errors() {
    let w = World::new();
    let c = w.client();
    let check = |n: u8, f: &dyn Fn(&mut DealTerms), err: Error| {
        let fp = w.fp(n);
        w.promise(&fp, SECURITY);
        let mut terms = w.terms(&w.new_share(), &fp);
        f(&mut terms);
        assert_eq!(
            c.try_list_deal(&terms, &w.sign_list(&terms)),
            Err(Ok(err)),
            "check {n}"
        );
    };
    check(30, &|t| t.markup = 1_501 * ONE, Error::MarkupTooHigh);
    check(
        31,
        &|t| t.platform_fee = t.markup + 1,
        Error::FeeExceedsMarkup,
    );
    check(32, &|t| t.deposit_bps = 3001, Error::DepositTooHigh);
    check(33, &|t| t.tenor_secs = 59, Error::TenorTooShort);
    check(34, &|t| t.halal_ok = false, Error::NotHalal);
    check(35, &|t| t.cost = 0, Error::InvalidTerms);
    check(36, &|t| t.markup = -1, Error::InvalidTerms);
    check(37, &|t| t.late_fee = -1, Error::InvalidTerms);
    check(38, &|t| t.funding_deadline = T0, Error::InvalidTerms);
    check(39, &|t| t.accept_window_secs = 0, Error::InvalidTerms);
    let other_token = Address::generate(&w.env);
    check(
        40,
        &|t| t.payout_token = other_token.clone(),
        Error::InvalidTerms,
    );
}

#[test]
fn share_token_probe_rejects_misconfigured_tokens() {
    let w = World::new();
    let c = w.client();
    // No clawback flag.
    let fp = w.fp(50);
    w.promise(&fp, SECURITY);
    let share = w.new_share_with(&[IssuerFlags::RequiredFlag, IssuerFlags::RevocableFlag]);
    let terms = w.terms(&share, &fp);
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::ShareTokenProbeFailed))
    );
    // No auth-required flag: balances start authorized.
    let share = w.new_share_with(&[IssuerFlags::RevocableFlag, IssuerFlags::ClawbackEnabledFlag]);
    let terms = w.terms(&share, &fp);
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::ShareTokenProbeFailed))
    );
    // Admin is not the contract.
    let issuer_admin = Address::generate(&w.env);
    let sac = w.env.register_stellar_asset_contract_v2(issuer_admin);
    sac.issuer().set_flag(IssuerFlags::RequiredFlag);
    sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    sac.issuer().set_flag(IssuerFlags::ClawbackEnabledFlag);
    let terms = w.terms(&sac.address(), &fp);
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::ShareTokenProbeFailed))
    );
    // Not a token at all.
    let terms = w.terms(&w.contract, &fp);
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::ShareTokenProbeFailed))
    );
    // A good token still lists.
    let terms = w.terms(&w.new_share(), &fp);
    c.list_deal(&terms, &w.sign_list(&terms));
}

#[test]
fn locked_shares_cannot_be_transferred() {
    let w = World::new();
    let (id, terms) = w.list(60);
    let inv = w.fund(id);
    let other = Address::generate(&w.env);
    let share = TokenClient::new(&w.env, &terms.share_token);
    assert_eq!(share.balance(&inv[0]), 5_000 * ONE);
    assert!(share.try_transfer(&inv[0], &other, &ONE).is_err());
    assert!(share.try_transfer(&inv[0], &inv[1], &ONE).is_err());
    assert_eq!(share.balance(&inv[0]), 5_000 * ONE);
    assert!(!StellarAssetClient::new(&w.env, &terms.share_token).authorized(&inv[0]));
}

#[test]
fn investor_not_approved_and_holder_cap() {
    let mut cfg = config();
    cfg.max_investors_per_deal = 2;
    let w = World::with_config(cfg);
    let c = w.client();
    let (id, _t) = w.list(61);
    let stranger = Address::generate(&w.env);
    w.mint(&stranger, ONE);
    assert_eq!(
        c.try_invest(&stranger, &id, &ONE),
        Err(Ok(Error::NotApprovedInvestor))
    );
    let a = w.new_investor(2 * ONE);
    let b = w.new_investor(ONE);
    let d = w.new_investor(ONE);
    c.invest(&a, &id, &ONE);
    c.invest(&b, &id, &ONE);
    assert_eq!(
        c.try_invest(&d, &id, &ONE),
        Err(Ok(Error::TooManyInvestors))
    );
    // An existing holder may still add.
    c.invest(&a, &id, &1);
    assert_eq!(c.get_deal(&id).holder_count, 2);
}
