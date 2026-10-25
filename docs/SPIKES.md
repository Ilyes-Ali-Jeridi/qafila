# Protocol spikes (PLAN 3.2)

Results override assumptions in the plan. Full detail with transaction hashes per track: `SPIKES-chain.md`, `SPIKES-intel.md`, `SPIKES-product.md`, `SPIKES-s2.md`.

| ID | Assumption | Result | Fallback used |
|---|---|---|---|
| SP1 | After `set_admin(contract)` and issuer master weight 0, the contract can still mint, authorize and claw back the share SAC | PASS (testnet, spike contract `sac_admin`) | none |
| SP2 | With `AUTH_REQUIRED` a C-address balance starts unauthorized; authorize then mint works; a deauthorized holder cannot transfer | PASS | none |
| SP3 | `clawback` works on a deauthorized balance | PASS | none |
| SP4 | A G-address holder gets the share trustline through the SAC `trust` call | PASS (classic `changeTrust` also works) | one-click trustline step in the invest flow |
| SP5 | A passkey smart account can call a contract with `require_auth` and a SAC transfer with sponsored fees | PASS through Qafila's own relayer, wallet in 4 to 10 s; the hosted SDF proxy refused calls over its 100 XLM/day per-IP budget | own relayer at api.qafila.dev/relayer |
| SP6 | An OpenZeppelin smart account with an ed25519 signer and a `CallContract(one contract)` rule can call that contract and nothing else | PASS | contract agent role stays the G key until the API signs as the smart account |
| SP7 | x402 settles through the OZ testnet facilitator with Circle USDC | Reaches the 402 challenge and signs the auth entry; settlement pending USDC on the payer account | Coinbase facilitator if needed |
| SP8 | ShipsGo returns vessel, ports, loading event for a real container | Key received at 18:00; live adapter wired; demo containers use a labelled recorded fixture | fixture |
| SP9 | Reflector testnet FX feed has CNY, NGN, KES | FAIL: EUR, GBP, CHF, CAD, MXN, ARS, BRL, THB, XAU only | ECB (frankfurter) for CNY; NGN and KES amounts hidden |
| SP10 | Trustless Work multi-release escrow deploys, funds, approves, releases on testnet | PASS on-chain; REST release/resolve blocked for qUSD because the fee account holds USDC only; 30 bps fee observed | `PaymentMode::Native`, flag off |
| SP11 | Attestation golden vectors identical in TypeScript and Rust and verified on-chain | PASS | none |
| SP12 | `getEvents` filtered by contract id with a working cursor | PASS | none |
| Rent (unplanned) | 30-day storage TTL affordable | FAIL: about 31k XLM per deal at current testnet rent | 1-day threshold, 7-day extension; keys topped up |
