//! Attestations: wrong signer, purpose, network, contract, deal id; the view;
//! and the golden vectors shared with TypeScript (SP11).
use super::*;
use crate::{attest, errors::Error};
use sha2::{Digest, Sha256};
use std::string::String;

fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

/// Re-derive the message in plain std and compare with the contract's builder.
#[test]
fn message_layout_matches_spec() {
    let w = World::new();
    let payload = w.fp(0x42);
    let network_id = w.env.ledger().get().network_id;
    let expected = sha256(&[
        b"QAFILA-ATTEST-V1",
        &1u32.to_be_bytes(),
        &network_id,
        &w.contract_xdr(),
        &7u64.to_be_bytes(),
        &[0x42; 32],
    ]);
    assert_eq!(w.message(1, 7, &payload), expected.to_vec());
    assert_eq!(attest::PREFIX.len(), 16);
}

#[test]
fn list_payload_is_sha256_of_terms_xdr() {
    let w = World::new();
    let terms = w.terms(&w.new_share(), &w.fp(1));
    let xdr: std::vec::Vec<u8> = w.env.as_contract(&w.contract, || {
        terms.clone().to_xdr(&w.env).iter().collect()
    });
    assert_eq!(w.list_payload(&terms).to_array(), sha256(&[&xdr]));
    let shipped = w.shipped_payload(&w.fp(0x11), &w.fp(0x22));
    assert_eq!(shipped.to_array(), sha256(&[&[0x11; 32], &[0x22; 32]]));
}

#[test]
fn verify_attestation_view_succeeds_and_traps() {
    let w = World::new();
    let c = w.client();
    let payload = w.fp(0x33);
    let sig = w.sign(PURPOSE_REPORT, 0, &payload);
    c.verify_attestation(&PURPOSE_REPORT, &0, &payload, &sig);
    assert!(c
        .try_verify_attestation(&PURPOSE_REPORT, &0, &payload, &sig)
        .is_ok());
    // Wrong purpose, deal id, payload, signer.
    assert!(c
        .try_verify_attestation(&PURPOSE_LIST, &0, &payload, &sig)
        .is_err());
    assert!(c
        .try_verify_attestation(&PURPOSE_REPORT, &1, &payload, &sig)
        .is_err());
    assert!(c
        .try_verify_attestation(&PURPOSE_REPORT, &0, &w.fp(0x34), &sig)
        .is_err());
    let other = w.sign_with(&signing_key(0x99), PURPOSE_REPORT, 0, &payload);
    assert!(c
        .try_verify_attestation(&PURPOSE_REPORT, &0, &payload, &other)
        .is_err());
    // Rotation: the new key verifies, the old one no longer does.
    let key = signing_key(0x99);
    c.set_verifier(&pk_bytes(&w.env, &key));
    assert!(c
        .try_verify_attestation(&PURPOSE_REPORT, &0, &payload, &other)
        .is_ok());
    assert!(c
        .try_verify_attestation(&PURPOSE_REPORT, &0, &payload, &sig)
        .is_err());
}

#[test]
fn list_rejects_bad_attestations() {
    let w = World::new();
    let c = w.client();
    let fp = w.fp(1);
    w.promise(&fp, SECURITY);
    let terms = w.terms(&w.new_share(), &fp);
    let payload = w.list_payload(&terms);
    // Wrong signer.
    let bad = w.sign_with(&signing_key(0x01), PURPOSE_LIST, 0, &payload);
    assert!(c.try_list_deal(&terms, &bad).is_err());
    // Wrong purpose.
    assert!(c
        .try_list_deal(&terms, &w.sign(PURPOSE_SHIPPED, 0, &payload))
        .is_err());
    // Wrong deal id (LIST uses 0).
    assert!(c
        .try_list_deal(&terms, &w.sign(PURPOSE_LIST, 1, &payload))
        .is_err());
    // Signed terms differ from submitted terms.
    let mut other = terms.clone();
    other.markup += 1;
    assert!(c.try_list_deal(&other, &w.sign_list(&terms)).is_err());
    // Wrong network: sign the message built with another network id.
    let mut net = w.env.ledger().get().network_id;
    net[0] ^= 1;
    let msg = sha256(&[
        b"QAFILA-ATTEST-V1",
        &PURPOSE_LIST.to_be_bytes(),
        &net,
        &w.contract_xdr(),
        &0u64.to_be_bytes(),
        &payload.to_array(),
    ]);
    let sig = BytesN::from_array(&w.env, &w.verifier.sign(&msg).to_bytes());
    assert!(c.try_list_deal(&terms, &sig).is_err());
    // Wrong contract: another address in the message.
    let mut other_contract = w.contract_xdr();
    let last = other_contract.len() - 1;
    other_contract[last] ^= 1;
    let msg = sha256(&[
        b"QAFILA-ATTEST-V1",
        &PURPOSE_LIST.to_be_bytes(),
        &w.env.ledger().get().network_id,
        &other_contract,
        &0u64.to_be_bytes(),
        &payload.to_array(),
    ]);
    let sig = BytesN::from_array(&w.env, &w.verifier.sign(&msg).to_bytes());
    assert!(c.try_list_deal(&terms, &sig).is_err());
    // The right one lists.
    c.list_deal(&terms, &w.sign_list(&terms));
}

#[test]
fn shipment_rejects_bad_attestations() {
    let w = World::new();
    let c = w.client();
    let (id, _t) = w.list(1);
    w.fund(id);
    c.pay_supplier_deposit(&w.agent, &id);
    let bl_fp = w.fp(0xC1);
    let bl_report = w.fp(0xD1);
    let payload = w.shipped_payload(&bl_fp, &bl_report);
    let wrong_deal = w.sign(PURPOSE_SHIPPED, id + 1, &payload);
    assert!(c
        .try_confirm_shipment(&w.agent, &id, &bl_fp, &bl_report, &wrong_deal)
        .is_err());
    let wrong_purpose = w.sign(PURPOSE_LIST, id, &payload);
    assert!(c
        .try_confirm_shipment(&w.agent, &id, &bl_fp, &bl_report, &wrong_purpose)
        .is_err());
    let wrong_signer = w.sign_with(&signing_key(0x02), PURPOSE_SHIPPED, id, &payload);
    assert!(c
        .try_confirm_shipment(&w.agent, &id, &bl_fp, &bl_report, &wrong_signer)
        .is_err());
    let good = w.sign(PURPOSE_SHIPPED, id, &payload);
    // Report hash swapped: payload differs.
    assert!(c
        .try_confirm_shipment(&w.agent, &id, &bl_fp, &w.fp(0xD2), &good)
        .is_err());
    assert_eq!(c.get_deal(&id).state, DealState::DepositPaid);
    c.confirm_shipment(&w.agent, &id, &bl_fp, &bl_report, &good);
    assert_eq!(c.get_deal(&id).state, DealState::Owned);
    assert_eq!(
        c.try_get_deal(&id).unwrap().unwrap().bl_fingerprint,
        Some(bl_fp)
    );
    let _ = Error::Overflow; // keep the import used
}

// ----------------------------------------------------------- golden vectors

#[derive(serde::Deserialize)]
#[allow(non_snake_case)]
struct Vectors {
    networkPassphrase: String,
    contractId: String,
    verifierPublicKeyHex: String,
    vectors: std::vec::Vec<Vector>,
}

#[derive(serde::Deserialize)]
#[allow(non_snake_case)]
struct Vector {
    purpose: serde_json::Value,
    dealId: serde_json::Value,
    payloadHashHex: String,
    messageHex: String,
    signatureHex: String,
    #[serde(default)]
    dealTerms: Option<serde_json::Value>,
    #[serde(default)]
    dealTermsXdrHex: Option<String>,
}

fn hex32(s: &str) -> [u8; 32] {
    hex::decode(s).unwrap().try_into().unwrap()
}

fn json_i128(v: &serde_json::Value) -> i128 {
    match v {
        serde_json::Value::String(s) => s.parse().unwrap(),
        serde_json::Value::Number(n) => n.as_i64().unwrap() as i128,
        _ => panic!("bad i128"),
    }
}

fn json_u64(v: &serde_json::Value) -> u64 {
    match v {
        serde_json::Value::String(s) => s.parse().unwrap(),
        serde_json::Value::Number(n) => n.as_u64().unwrap(),
        _ => panic!("bad u64"),
    }
}

fn terms_from_json(env: &Env, v: &serde_json::Value) -> DealTerms {
    let s = |k: &str| v[k].as_str().unwrap();
    let b32 = |k: &str| BytesN::from_array(env, &hex32(s(k)));
    DealTerms {
        importer: Address::from_str(env, s("importer")),
        supplier: Address::from_str(env, s("supplier")),
        share_token: Address::from_str(env, s("share_token")),
        payout_token: Address::from_str(env, s("payout_token")),
        cost: json_i128(&v["cost"]),
        deposit_bps: v["deposit_bps"].as_u64().unwrap() as u32,
        markup: json_i128(&v["markup"]),
        platform_fee: json_i128(&v["platform_fee"]),
        late_fee: json_i128(&v["late_fee"]),
        funding_deadline: json_u64(&v["funding_deadline"]),
        accept_window_secs: json_u64(&v["accept_window_secs"]),
        tenor_secs: json_u64(&v["tenor_secs"]),
        listing_fingerprint: b32("listing_fingerprint"),
        report_hash: b32("report_hash"),
        promise_hash: b32("promise_hash"),
        halal_ok: v["halal_ok"].as_bool().unwrap(),
        payment_mode: match s("payment_mode") {
            "Native" => PaymentMode::Native,
            _ => PaymentMode::TrustlessWork,
        },
        security: json_i128(&v["security"]),
    }
}

/// SP11: every vector in data/golden/attestation_vectors.json must reproduce
/// byte for byte and verify on-chain against the vector's contract address.
#[test]
fn golden_vectors_match_typescript() {
    let path = std::format!(
        "{}/../../data/golden/attestation_vectors.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).expect("run `pnpm golden-vectors` first");
    let v: Vectors = serde_json::from_str(&text).unwrap();
    assert_eq!(v.networkPassphrase, TESTNET_PASSPHRASE);

    let env = Env::default();
    env.mock_all_auths();
    env.ledger()
        .with_mut(|li| li.network_id = sha256(&[v.networkPassphrase.as_bytes()]));
    let contract = Address::from_str(&env, &v.contractId);
    let admin = Address::generate(&env);
    let settlement = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    env.register_at(
        &contract,
        QafilaDeals,
        (
            admin.clone(),
            BytesN::from_array(&env, &hex32(&v.verifierPublicKeyHex)),
            admin.clone(),
            admin.clone(),
            settlement,
            config(),
        ),
    );
    let client = QafilaDealsClient::new(&env, &contract);
    assert!(!v.vectors.is_empty());
    let mut saw_list = false;
    for vec in &v.vectors {
        let purpose = json_u64(&vec.purpose) as u32;
        let deal_id = json_u64(&vec.dealId);
        let payload = BytesN::from_array(&env, &hex32(&vec.payloadHashHex));
        let msg: std::vec::Vec<u8> = env.as_contract(&contract, || {
            attest::message(&env, purpose, deal_id, &payload)
                .iter()
                .collect()
        });
        assert_eq!(
            hex::encode(&msg),
            vec.messageHex,
            "message purpose {}",
            vec.purpose
        );
        let sig: [u8; 64] = hex::decode(&vec.signatureHex).unwrap().try_into().unwrap();
        let sig = BytesN::from_array(&env, &sig);
        client.verify_attestation(&purpose, &deal_id, &payload, &sig);
        if let Some(terms) = &vec.dealTerms {
            saw_list = true;
            let terms = terms_from_json(&env, terms);
            let (xdr, hash): (std::vec::Vec<u8>, BytesN<32>) = env.as_contract(&contract, || {
                (
                    terms.clone().to_xdr(&env).iter().collect(),
                    attest::list_payload_hash(&env, &terms),
                )
            });
            if let Some(x) = &vec.dealTermsXdrHex {
                assert_eq!(hex::encode(&xdr), *x, "DealTerms XDR");
            }
            assert_eq!(hash, payload, "LIST payload hash");
        }
    }
    assert!(saw_list, "the LIST vector must carry dealTerms");
}
