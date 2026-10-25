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
| SP1 | After `set_admin(contract)` and issuer master weight 0, the contract can still `mint`, `set_authorized`, `clawback` on the share SAC | pending | | |
| SP2 | With `AUTH_REQUIRED` a C-address balance starts unauthorized; `set_authorized(C, true)` then `mint`; transfer by a deauthorized holder fails | pending | | |
| SP3 | `clawback` works on a deauthorized balance | pending | | |
| SP4 | How a G-address holder gets a share trustline (SAC or classic `changeTrust`) | pending | | |
| SP6 | OZ smart account with ed25519 signer and a one-contract policy can call that contract and cannot transfer tokens | pending | | |
| SP11 | Attestation golden vectors identical in TS and Rust, verify on-chain | pending | | |
| SP12 | `getEvents` filtered by contract id returns events with a working cursor | pending | | |
