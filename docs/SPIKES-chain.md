# Protocol spikes (Track A, chain)

Times WET. Network: Stellar testnet (protocol 29), soroban-sdk 28.0.0, stellar CLI 28.1.0.
Explorer prefix: https://stellar.expert/explorer/testnet/tx/<hash>

## Hour 0 handoff (15:05 to 15:20)

| Item | Value | Tx |
|---|---|---|
| Probe contract (`contracts/spikes/probe`) | `CD7JYELMF6W5LLWINWJ7XO6BYAMDFBYLJ4VTMTOZ3LWCFH2MZ7MQWXZP` | upload `5c4e98d61409d8402d057f4364658f05c410bd9893ebd137d7959318dc77692a`, deploy `8e6274a8b528202a7e91ea1ea1d9049ecc08e79632687f123238329f172b96cf` |
| qUSD SAC (`qUSD:GDZE4PY2VVPCOTERMIETEB73XA5KDHI25ZGDAINMCTEXYBJCG76H63VA`, issuer has no auth flags) | `CB7WLKU45NHMLECCZGP5H6RH5IHMSHJXA7U4JSNM4MQT7WT46LZMC3KZ` | `d637287233f049c452459c508e911403f2602d9e09eee6f497d1af520a114e7f` |
| Faucet stock | 10,000,000 qUSD on `GCUML2CBHDS6NU2TNMFH62OUWUDLQ5IE4SQCN4M7G2XPUUMGESPZQTR4` | see `.shared/probe.json` |

Probe function: `probe(caller: Address, token: Address, to: Address, amount: i128) -> i128` (`caller.require_auth()`, then `token.transfer(caller, to, amount)`).
Public keys for every role: `.shared/accounts.json`. Secrets: `.env` (never committed).

Note for anyone running the stellar CLI from the repo root: the CLI reads `.env` and needs `STELLAR_NETWORK_PASSPHRASE` next to `STELLAR_RPC_URL` (added to `.env.example`).

## Spike table

| ID | Assumption | Result | Evidence | Fallback used |
|---|---|---|---|---|
| SP1 | After `set_admin(contract)` and issuer master weight 0, the contract can still `mint`, `set_authorized`, `clawback` on the share SAC | **PASS** 15:48 | Spike contract `contracts/spikes/sac_admin` = `CD2ULYK6GXHCCDNLD2VX4UCBCWRLC2AEZHIYSZNRD5RBGINWLON7MOCK`; share `QF00000001:GCJUYSIY63DER3RXZOJPMQ5LEON7HNRTMYSUN4YVDWKKOHPTXEJ4EG6J` SAC `CDHVBXCK3QRTFJQDFCPFJ33LI27K4VMWVJIZNR67DIEJVTBIJJ3X2ZXE`; flags set `69e3f311219ce88e6330480aa3916748a9324750eb398d3c73391bd69d8df824`, SAC deploy `e82eaba6e2fe24ab4d7fd3ec2b4683468732d18d94f305dc8f0c3f026b4379f8`, `set_admin(spike)` `6ed014a3a592800034d8dce84d1f7bdb545f3d36f970d1f2bba6dd62e1176ddf`, master weight 0 `e61bcbd7e008629613940996187326402898f33c86344fc4fa5dacda23f89c89` (Horizon: flags required+revocable+clawback, one signer weight 0, home_domain qafila.dev). Then `probe(share)` from the contract (admin()==self, authorized(self)==false, set_authorized, mint 1, clawback 1, set_authorized false) returned `true`: `057dab801e5c5e777e733bd92bc50e166ce675eeab559983d9628d438533e182` | none |
| SP2 | With `AUTH_REQUIRED` a C-address balance starts unauthorized; `set_authorized(C, true)` then `mint`; transfer by a deauthorized holder fails | **PASS** 15:50 | C address (the spike contract itself): `authorized == false` before and after `issue` (set_authorized true, mint 5, set_authorized false) `44994594e20536c806ec5cf85ce29e382067a85523da9b0f4a3d7eb01787bcce`; `try_self_transfer` by the deauthorized C holder returned `false` (simulation). G address holder: after `issue` 100 `4a70f4c3905700dccd1078754d48d00dc8745925aa13fe7255d1797f3f91baae`, `authorized == false`; its SAC `transfer` fails in simulation with SAC `Error(Contract, #11)` "balance is deauthorized"; a classic payment of the share is rejected too (balance stayed 100 until the clawback) | none |
| SP3 | `clawback` works on a deauthorized balance | **PASS** 15:52 | `clawback(holder, 100)` on the deauthorized G balance: `e404200c93f5c0ee267a6ae2f7515454b33bc4a88f639c34c14682ff9a11ff86` (balance 0 after); on the deauthorized C balance (5): `a32f34b5b93006bfc84a82947fc65bbe21554f1413b266b94320524270dd0bd1`. No authorize-first step needed; `claw_auth_first` kept in the spike as the fallback | none |
| SP4 | How a G-address holder gets a share trustline (SAC or classic `changeTrust`) | **PASS** 15:51 | SAC `trust(addr)` (protocol 29 testnet) called by the G holder created the share trustline with no issuer involvement: `6751acb7bbf33fd36487552d4cbddca87cf1e75e1ba01182acb834e092172858`; Horizon shows the `QF00000001` trustline `is_authorized: false`, `is_clawback_enabled: true`. G investors get the trustline with one SAC call (`stellar contract invoke --id <share> -- trust --addr <G>`), or classic `changeTrust`; smart accounts need none | none |
| SP6 | OZ smart account with ed25519 signer and a one-contract policy can call that contract and cannot transfer tokens | pending | | |
| SP11 | Attestation golden vectors identical in TS and Rust, verify on-chain | pending | | |
| SP12 | `getEvents` filtered by contract id returns events with a working cursor | pending | | |
