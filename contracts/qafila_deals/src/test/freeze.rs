//! Pause semantics: state changes blocked; cancel, claim, close, sweeps,
//! withdraw_promise and withdraw_refund keep working.
use super::*;
use crate::errors::Error;

#[test]
fn pause_blocks_state_changes_but_allows_exits() {
    let w = World::new();
    let c = w.client();
    let (sold_id, _t, _inv) = w.sold(1);
    let (listed_id, _t) = w.list(2);
    let (cancel_id, _t) = w.list(3);
    let inv = w.fund(cancel_id);
    c.abort_deal(&cancel_id, &false);
    let fp = w.fp(4);
    w.promise(&fp, SECURITY);
    let a = w.new_investor(ONE);
    w.mint(&w.importer, 10 * COST);

    c.pause();
    assert!(c.get_roles().paused);
    assert_eq!(c.try_pause(), Err(Ok(Error::InvalidState)));

    assert_eq!(
        c.try_promise_purchase(&w.importer, &w.fp(5), &w.fp(6), &SECURITY),
        Err(Ok(Error::Paused))
    );
    let terms = w.terms(&w.new_share(), &w.fp(7));
    assert_eq!(
        c.try_list_deal(&terms, &w.sign_list(&terms)),
        Err(Ok(Error::Paused))
    );
    assert_eq!(c.try_invest(&a, &listed_id, &ONE), Err(Ok(Error::Paused)));
    assert_eq!(
        c.try_pay_supplier_deposit(&w.agent, &listed_id),
        Err(Ok(Error::Paused))
    );
    assert_eq!(c.try_repay(&sold_id, &ONE), Err(Ok(Error::Paused)));
    assert_eq!(c.try_abort_deal(&listed_id, &false), Err(Ok(Error::Paused)));
    assert_eq!(c.try_mark_default(&sold_id), Err(Ok(Error::Paused)));
    assert_eq!(
        c.try_extend_due(&sold_id, &(w.now() + 1)),
        Err(Ok(Error::Paused))
    );

    // Exits still work.
    assert_eq!(c.withdraw_promise(&w.importer, &fp), SECURITY);
    assert_eq!(c.claim(&inv[0], &cancel_id), 5_000 * ONE);
    assert_eq!(c.withdraw_refund(&w.importer), SECURITY);
    w.claim_all(cancel_id, &inv[1..]);
    c.close_deal(&cancel_id);
    assert_eq!(c.sweep_charity(), 0);
    assert_eq!(c.sweep_treasury(), 0);
    w.advance(FUNDING_WINDOW + 1);
    c.cancel_unfunded(&listed_id);
    // Admin functions work while paused.
    c.approve_investor(&a);
    let key = signing_key(0x12);
    c.set_verifier(&pk_bytes(&w.env, &key));

    c.unpause();
    assert!(!c.get_roles().paused);
    assert_eq!(c.try_unpause(), Err(Ok(Error::InvalidState)));
    w.assert_books_balance(&[sold_id, listed_id, cancel_id]);
}

#[test]
fn ttl_is_extended_on_writes() {
    use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
    let w = World::new();
    let (id, _t) = w.list(1);
    let (inst_ttl, deal_ttl) = w.env.as_contract(&w.contract, || {
        (
            w.env.storage().instance().get_ttl(),
            w.env.storage().persistent().get_ttl(&DataKey::Deal(id)),
        )
    });
    assert!(
        inst_ttl >= storage::TTL_EXTEND_TO - 1,
        "instance ttl {inst_ttl}"
    );
    assert!(
        deal_ttl >= storage::TTL_EXTEND_TO - 1,
        "deal ttl {deal_ttl}"
    );
}
