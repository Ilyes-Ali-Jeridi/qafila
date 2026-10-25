# Spikes, Track C (product)

## SP5: passkey smart account calls a contract with require_auth + SAC transfer, fees sponsored

Setup: smart-account-kit 0.8.0, account wasm `1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a`, WebAuthn verifier `CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F`, relayer proxy `https://smart-account-relayer-proxy.sdf-ecosystem.workers.dev`, probe `CD7JYELMF6W5LLWINWJ7XO6BYAMDFBYLJ4VTMTOZ3LWCFH2MZ7MQWXZP` (Track A), qUSD SAC `CB7WLKU45NHMLECCZGP5H6RH5IHMSHJXA7U4JSNM4MQT7WT46LZMC3KZ`.

Harness: `apps/web/app/dev/sp5` (development only) driven by `apps/web/e2e/sp5.spec.ts` with Chromium's virtual WebAuthn authenticator (ctap2, internal, resident key, user verified).

Steps: create wallet (relayer deploys) -> faucet sends 50 test dollars to the C address (mock API, real SAC transfer) -> `kit.executeAndSubmit(probe, 'probe', [caller, token, to, 1.0000000])` -> `kit.signAndSubmit(client.probe(...))`.

Result: pending (run in progress).
