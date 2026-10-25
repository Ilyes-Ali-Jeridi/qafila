//! Per-deal share token (a classic asset's SAC whose admin is this contract).
//! Shares are compliance-locked: the holder is authorized only for the mint.
use soroban_sdk::{
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

use crate::errors::Error;

fn probe_ok<T, E1, E2>(r: Result<Result<T, E1>, E2>) -> Result<T, Error> {
    match r {
        Ok(Ok(v)) => Ok(v),
        _ => Err(Error::ShareTokenProbeFailed),
    }
}

/// `list_deal` probe (PLAN 3.3.4): `admin() == self`, `authorized(self) == false`,
/// then `set_authorized(self, true)`, `mint(self, 1)`, `clawback(self, 1)`,
/// `set_authorized(self, false)`. Any failure is `ShareTokenProbeFailed`.
/// Proven on testnet with a locked issuer (SP1 to SP3).
pub fn probe(env: &Env, share: &Address) -> Result<(), Error> {
    let me = env.current_contract_address();
    let sac = StellarAssetClient::new(env, share);
    if probe_ok(sac.try_admin())? != me {
        return Err(Error::ShareTokenProbeFailed);
    }
    if probe_ok(sac.try_authorized(&me))? {
        return Err(Error::ShareTokenProbeFailed);
    }
    probe_ok(sac.try_set_authorized(&me, &true))?;
    probe_ok(sac.try_mint(&me, &1))?;
    probe_ok(sac.try_clawback(&me, &1))?;
    probe_ok(sac.try_set_authorized(&me, &false))?;
    if probe_ok(sac.try_authorized(&me))? {
        return Err(Error::ShareTokenProbeFailed);
    }
    if probe_ok(TokenClient::new(env, share).try_balance(&me))? != 0 {
        return Err(Error::ShareTokenProbeFailed);
    }
    Ok(())
}

/// Authorize, mint, deauthorize: the holder ends up with locked shares.
pub fn mint_locked(env: &Env, share: &Address, holder: &Address, amount: i128) {
    let sac = StellarAssetClient::new(env, share);
    sac.set_authorized(holder, &true);
    sac.mint(holder, &amount);
    sac.set_authorized(holder, &false);
}

pub fn balance(env: &Env, share: &Address, holder: &Address) -> i128 {
    TokenClient::new(env, share).balance(holder)
}

/// Clawback works on a deauthorized balance (SP3 PASS), so no authorize step.
pub fn clawback(env: &Env, share: &Address, holder: &Address, amount: i128) {
    StellarAssetClient::new(env, share).clawback(holder, &amount);
}
