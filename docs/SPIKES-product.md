# Spikes, Track C (product)

## SP5: passkey smart account calls a contract with require_auth + SAC transfer, fees sponsored

Setup: smart-account-kit 0.8.0, account wasm `1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a`, WebAuthn verifier `CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F`, relayer proxy `https://smart-account-relayer-proxy.sdf-ecosystem.workers.dev`, probe `CD7JYELMF6W5LLWINWJ7XO6BYAMDFBYLJ4VTMTOZ3LWCFH2MZ7MQWXZP` (Track A), qUSD SAC `CB7WLKU45NHMLECCZGP5H6RH5IHMSHJXA7U4JSNM4MQT7WT46LZMC3KZ`.

Harness: `apps/web/app/dev/sp5` (development only) driven by `apps/web/e2e/sp5.spec.ts` with Chromium's virtual WebAuthn authenticator (ctap2, internal, resident key, user verified).

Steps: create wallet (relayer deploys) -> faucet sends 50 test dollars to the C address (mock API, real SAC transfer) -> `kit.executeAndSubmit(probe, 'probe', [caller, token, to, 1.0000000])` -> `kit.signAndSubmit(client.probe(...))`.

Result: **PASS** (Sun 25 Oct 15:59 WET), run `apps/web/e2e/sp5.spec.ts` against the dev server, mock API and Qafila relayer.

| Step | Result | Time | Transaction |
|---|---|---|---|
| Create wallet (passkey, createContractV2 through the relayer) | PASS | 7.2 s | `b3791a3baa9501d7c05d1c2dbb45b5834590390c43e0fc003c108dcefd1c2896` |
| Faucet: 50 test dollars to the C address (SAC transfer signed by the faucet key) | PASS | 3.7 s | `c5567fb1f1e18579517b3315869115306ead4b12c523f02b3273748dbec6af83` |
| `kit.executeAndSubmit(probe, 'probe', [caller, token, charity, 1.0000000])` (wallet.execute -> probe, sponsored) | PASS | 5.2 s | `d195456c9595a04b8f48bc317b7fcc76499ea736d9a19cd1ea8fefb794f28ba4` |
| `kit.signAndSubmit(client.probe({caller, token, to, amount}))` (direct call, auth entry signed by the passkey, sponsored) | PASS | 9.8 s | `c200eb30459497ab8692b774da257cfd8bb82efed19d5ae7c71a7b445e82dd2a` |

Wallet: `CA4AB4M6I3TKNXN4IW6AG35JLSO7SRP66WZA34KILBOA4J6UVSXZJHMC`. Earlier wallets on the same path: `CBTIMGAALCOAJRV2NP3NQMEQBPRBQDIBSPP6HFSNIAHMY26L6MAGNRRJ`, `CD5COFFHUHIORWNGNRHTSGGQGOJQUVC6IZUOKO43RZMBP3TZ56UHCGJY`.

Findings along the way:
1. smart-account-kit 0.8.0 breaks on stellar-sdk 17 (`discoveredAuth[0].rootInvocation is not a function`, Track A saw `entry.credentials is not a function`): the SDK 17 XDR classes changed accessors. Fix: the web app pins `@stellar/stellar-sdk` 16.4.1 and aliases every import (including the generated bindings) to that one copy.
2. The hosted relayer proxy (`smart-account-relayer-proxy.sdf-ecosystem.workers.dev`) deploys wallets fine (9 to 15 s) but OpenZeppelin Channels refuses calls with "Transaction fee (600506798 stroops) exceeds remaining budget (159389764 stroops). Consumed 840610236/1000000000": it bids about 60 XLM per call against a 100 XLM daily budget per client IP, while testnet fee stats show p99 = 200 stroops. Unusable at a venue behind one IP. Fix: Qafila's own relayer (`apps/web/mock-api/relayer.ts`, kit protocol, inclusion fee 10,000 stroops).
3. Testnet rent is very high right now (Track A's note): the probe call's resource fee was 70.6 XLM because it creates persistent entries (first qUSD balance of the C address). The relayer caps the resource fee at 150 XLM and must be funded generously (friendbot accounts paid into it).
4. The kit sends an `x-client-version` header; the relayer's CORS must reflect requested headers.

Decision: `invest`, `promise_purchase`, `accept_murabaha`, `repay`, `pay_late_fee`, `claim`, `withdraw_refund`, `withdraw_promise` are built with the generated client and submitted with `kit.signAndSubmit` (direct path, PLAN 4.1), fees sponsored by the Qafila relayer. `NEXT_PUBLIC_PASSKEY_PATH=execute` switches to `kit.executeAndSubmit` (wallet.execute -> Qafila), which also passed. Fallback (Freighter for investing) not needed.

