//! Auth failures for every restricted function; `caller` that is neither admin nor agent.
use super::*;
use crate::errors::Error;
use soroban_sdk::testutils::{AuthorizedFunction, AuthorizedInvocation, MockAuth, MockAuthInvoke};
use soroban_sdk::{IntoVal, Symbol};

/// With no auth mocked at all, every restricted call must fail at the host level.
#[test]
fn restricted_functions_fail_without_auth() {
    let w = World::new();
    let (id, _t, _inv) = w.sold(1);
    let (owned_id, _t, _inv) = w.owned(2);
    let (listed_id, _t) = w.list(3);
    let inv = w.new_investor(ONE);
    w.mint(&w.importer, 10 * SECURITY);
    let fp = w.fp(9);
    let terms = w.terms(&w.new_share(), &fp);
    let sig = w.sign_list(&terms);
    let c = w.client();

    w.env.set_auths(&[]);
    assert!(c.try_set_agent(&w.agent).is_err());
    assert!(c.try_set_verifier(&w.fp(1)).is_err());
    assert!(c.try_set_config(&config()).is_err());
    assert!(c.try_set_charity(&w.charity).is_err());
    assert!(c.try_set_treasury(&w.treasury).is_err());
    assert!(c.try_approve_investor(&inv).is_err());
    assert!(c.try_revoke_investor(&inv).is_err());
    assert!(c.try_pause().is_err());
    assert!(c.try_upgrade(&w.fp(2)).is_err());
    assert!(c
        .try_promise_purchase(&w.importer, &fp, &w.fp(0xBB), &SECURITY)
        .is_err());
    assert!(c.try_withdraw_promise(&w.importer, &w.fp(1)).is_err());
    assert!(c.try_list_deal(&terms, &sig).is_err());
    assert!(c.try_invest(&inv, &listed_id, &ONE).is_err());
    assert!(c.try_pay_supplier_deposit(&w.agent, &listed_id).is_err());
    assert!(c
        .try_confirm_shipment(
            &w.agent,
            &owned_id,
            &w.fp(3),
            &w.fp(4),
            &BytesN::from_array(&w.env, &[5u8; 64])
        )
        .is_err());
    assert!(c.try_accept_murabaha(&owned_id).is_err());
    assert!(c.try_repay(&id, &ONE).is_err());
    assert!(c.try_pay_late_fee(&id, &ONE).is_err());
    assert!(c.try_extend_due(&id, &(w.now() + 100)).is_err());
    assert!(c.try_abort_deal(&owned_id, &true).is_err());
    assert!(c.try_mark_default(&id).is_err());
    assert!(c.try_deposit_recovery(&id, &inv, &ONE).is_err());
    assert!(c.try_finalize_default(&id).is_err());
}

#[test]
fn caller_neither_admin_nor_agent_is_rejected() {
    let w = World::new();
    let c = w.client();
    let (id, _t) = w.list(1);
    w.fund(id);
    let stranger = Address::generate(&w.env);
    assert_eq!(
        c.try_pay_supplier_deposit(&stranger, &id),
        Err(Ok(Error::NotAuthorized))
    );
    // Admin may pay; agent may confirm.
    c.pay_supplier_deposit(&w.admin, &id);
    let bl_fp = w.fp(0xC1);
    let bl_report = w.fp(0xD1);
    let sig = w.sign_shipped(id, &bl_fp, &bl_report);
    assert_eq!(
        c.try_confirm_shipment(&stranger, &id, &bl_fp, &bl_report, &sig),
        Err(Ok(Error::NotAuthorized))
    );
    c.confirm_shipment(&w.agent, &id, &bl_fp, &bl_report, &sig);
}

#[test]
fn invest_requires_the_investor_signature_only() {
    let w = World::new();
    let (id, _t) = w.list(1);
    let inv = w.new_investor(10 * ONE);
    let c = w.client();
    // Only the investor's auth, including the inner token transfer.
    w.env.mock_auths(&[MockAuth {
        address: &inv,
        invoke: &MockAuthInvoke {
            contract: &w.contract,
            fn_name: "invest",
            args: (&inv, id, 5 * ONE).into_val(&w.env),
            sub_invokes: &[MockAuthInvoke {
                contract: &w.settlement,
                fn_name: "transfer",
                args: (&inv, &w.contract, 5 * ONE).into_val(&w.env),
                sub_invokes: &[],
            }],
        },
    }]);
    c.invest(&inv, &id, &(5 * ONE));
    let auths = w.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(
        auths[0],
        (
            inv.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    w.contract.clone(),
                    Symbol::new(&w.env, "invest"),
                    (&inv, id, 5 * ONE).into_val(&w.env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        w.settlement.clone(),
                        Symbol::new(&w.env, "transfer"),
                        (&inv, &w.contract, 5 * ONE).into_val(&w.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )
    );
}

#[test]
fn claim_and_withdraw_refund_need_no_auth() {
    let w = World::new();
    let c = w.client();
    let (id, _t) = w.list(1);
    let inv = w.fund(id);
    c.abort_deal(&id, &false);
    w.env.set_auths(&[]);
    assert_eq!(c.claim(&inv[0], &id), 5_000 * ONE);
    assert_eq!(c.withdraw_refund(&w.importer), SECURITY);
    assert_eq!(c.sweep_charity(), 0);
    assert_eq!(c.sweep_treasury(), 0);
}

#[test]
fn admin_functions_update_roles_and_config() {
    let w = World::new();
    let c = w.client();
    let new_agent = Address::generate(&w.env);
    c.set_agent(&new_agent);
    assert_eq!(c.get_roles().agent, Some(new_agent.clone()));
    let new_charity = Address::generate(&w.env);
    c.set_charity(&new_charity);
    let new_treasury = Address::generate(&w.env);
    c.set_treasury(&new_treasury);
    let roles = c.get_roles();
    assert_eq!(roles.charity, new_charity);
    assert_eq!(roles.treasury, new_treasury);
    let mut cfg = config();
    cfg.max_markup_bps = 1000;
    c.set_config(&cfg);
    assert_eq!(c.get_config().max_markup_bps, 1000);
    cfg.max_markup_bps = 10_001;
    assert_eq!(c.try_set_config(&cfg), Err(Ok(Error::InvalidTerms)));
    cfg.max_markup_bps = 1000;
    cfg.security_floor_bps = 3000; // above min
    assert_eq!(c.try_set_config(&cfg), Err(Ok(Error::InvalidTerms)));
    // The old agent can no longer act.
    let (id, _t) = w.list(1);
    w.fund(id);
    assert_eq!(
        c.try_pay_supplier_deposit(&w.agent, &id),
        Err(Ok(Error::NotAuthorized))
    );
    c.pay_supplier_deposit(&new_agent, &id);
}
