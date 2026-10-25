//! Track A fills these per PLAN 3.3.7 and FLOWS 8: lifecycle, auth, math, attest,
//! default, cancel, freeze, proptest.
use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

fn config() -> Config {
    Config {
        max_markup_bps: 1500,
        max_deposit_bps: 3000,
        max_investors_per_deal: 100,
        min_tenor_secs: 60,
        grace_secs: 60,
        base_importer_limit: 200_000_000_000,
        limit_step: 100_000_000_000,
        min_security_bps: 2000,
        security_step_bps: 250,
        security_floor_bps: 1000,
        max_extension_secs: 600,
    }
}

#[test]
fn constructor_stores_roles() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let charity = Address::generate(&env);
    let treasury = Address::generate(&env);
    let settlement = Address::generate(&env);
    let verifier = BytesN::from_array(&env, &[7u8; 32]);
    let id = env.register(
        QafilaDeals,
        (
            admin.clone(),
            verifier.clone(),
            charity.clone(),
            treasury.clone(),
            settlement.clone(),
            config(),
        ),
    );
    let client = QafilaDealsClient::new(&env, &id);
    let roles = client.get_roles();
    assert_eq!(roles.admin, admin);
    assert_eq!(roles.verifier, verifier);
    assert_eq!(roles.settlement, settlement);
    assert_eq!(roles.next_deal_id, 1);
    assert!(!roles.paused);
    assert_eq!(client.get_config().min_security_bps, 2000);
    assert_eq!(client.owed().charity, 0);
}
