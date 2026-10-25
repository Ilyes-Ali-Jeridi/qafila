//! Attestations signed by the verification service (PLAN 3.3.6).
//!
//! ```text
//! msg = sha256("QAFILA-ATTEST-V1" || u32be purpose || network_id || contract_address_xdr
//!              || u64be deal_id || payload_hash)
//! ```
//! `ed25519_verify` traps on an invalid signature; the whole call aborts.
use soroban_sdk::{xdr::ToXdr, Bytes, BytesN, Env};

use crate::{errors::Error, storage, types::DealTerms};

pub const PREFIX: &[u8; 16] = b"QAFILA-ATTEST-V1";

/// The 32-byte message the verifier signs, as `Bytes`.
pub fn message(env: &Env, purpose: u32, deal_id: u64, payload_hash: &BytesN<32>) -> Bytes {
    let mut b = Bytes::new(env);
    b.extend_from_slice(PREFIX);
    b.extend_from_array(&purpose.to_be_bytes());
    b.extend_from_array(&env.ledger().network_id().to_array());
    b.append(&env.current_contract_address().to_xdr(env));
    b.extend_from_array(&deal_id.to_be_bytes());
    b.extend_from_array(&payload_hash.to_array());
    env.crypto().sha256(&b).into()
}

/// Verifies `sig` over the attestation message with the stored verifier key.
/// Traps (host error) if the signature is invalid.
pub fn verify(
    env: &Env,
    purpose: u32,
    deal_id: u64,
    payload_hash: &BytesN<32>,
    sig: &BytesN<64>,
) -> Result<(), Error> {
    let pk = storage::verifier(env)?;
    let msg = message(env, purpose, deal_id, payload_hash);
    env.crypto().ed25519_verify(&pk, &msg, sig);
    Ok(())
}

/// LIST payload: `sha256(XDR of DealTerms)`.
pub fn list_payload_hash(env: &Env, terms: &DealTerms) -> BytesN<32> {
    let xdr = terms.clone().to_xdr(env);
    env.crypto().sha256(&xdr).into()
}

/// SHIPPED payload: `sha256(bl_fingerprint || bl_report_hash)`.
pub fn shipped_payload_hash(
    env: &Env,
    bl_fingerprint: &BytesN<32>,
    bl_report_hash: &BytesN<32>,
) -> BytesN<32> {
    let mut b = Bytes::new(env);
    b.extend_from_array(&bl_fingerprint.to_array());
    b.extend_from_array(&bl_report_hash.to_array());
    env.crypto().sha256(&b).into()
}
