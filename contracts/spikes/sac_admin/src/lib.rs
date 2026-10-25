//! Spike contract for SP1, SP2, SP3 (PLAN 3.2): this contract is the SAC admin of a
//! share token whose issuer is locked. It runs the exact `list_deal` probe and the
//! invest / claim token sequences so the assumptions are proven on testnet before
//! `qafila_deals` depends on them.
#![no_std]
use soroban_sdk::{
    contract, contractimpl,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

#[contract]
pub struct SacAdmin;

#[contractimpl]
impl SacAdmin {
    /// The `list_deal` share-token probe: admin == self, self unauthorized, then
    /// authorize, mint 1, claw back 1, deauthorize. Returns false on a soft failure;
    /// a host trap from the SAC (missing flag) aborts the call.
    pub fn probe(env: Env, share: Address) -> bool {
        let me = env.current_contract_address();
        let sac = StellarAssetClient::new(&env, &share);
        if sac.admin() != me {
            return false;
        }
        if sac.authorized(&me) {
            return false;
        }
        sac.set_authorized(&me, &true);
        sac.mint(&me, &1);
        sac.clawback(&me, &1);
        sac.set_authorized(&me, &false);
        !sac.authorized(&me) && TokenClient::new(&env, &share).balance(&me) == 0
    }

    /// `invest` token sequence: authorize, mint, deauthorize (compliance-locked shares).
    pub fn issue(env: Env, share: Address, holder: Address, amount: i128) -> i128 {
        let sac = StellarAssetClient::new(&env, &share);
        sac.set_authorized(&holder, &true);
        sac.mint(&holder, &amount);
        sac.set_authorized(&holder, &false);
        TokenClient::new(&env, &share).balance(&holder)
    }

    pub fn is_authorized(env: Env, share: Address, holder: Address) -> bool {
        StellarAssetClient::new(&env, &share).authorized(&holder)
    }

    /// `claim` token sequence (SP3): clawback from a deauthorized holder.
    pub fn claw(env: Env, share: Address, holder: Address, amount: i128) -> i128 {
        let sac = StellarAssetClient::new(&env, &share);
        sac.clawback(&holder, &amount);
        TokenClient::new(&env, &share).balance(&holder)
    }

    /// SP3 fallback variant: authorize first, then claw back, then deauthorize.
    pub fn claw_auth_first(env: Env, share: Address, holder: Address, amount: i128) -> i128 {
        let sac = StellarAssetClient::new(&env, &share);
        sac.set_authorized(&holder, &true);
        sac.clawback(&holder, &amount);
        sac.set_authorized(&holder, &false);
        TokenClient::new(&env, &share).balance(&holder)
    }

    /// SP2: this contract (a deauthorized C-address holder) tries to transfer its shares.
    /// Returns true if the transfer went through (it must not).
    pub fn try_self_transfer(env: Env, share: Address, to: Address, amount: i128) -> bool {
        let me = env.current_contract_address();
        TokenClient::new(&env, &share)
            .try_transfer(&me, &to, &amount)
            .is_ok()
    }
}
