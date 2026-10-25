# Spikes, Track B (intelligence)

Times are WET (Lisbon), Sunday 25 October 2026.

## SP-LLM: Bedrock Qwen tool use (14:40) PASS
- Region eu-west-1, account 324037291272. Converse API with `toolConfig` plus `toolChoice: { tool }`, temperature 0.
- `qwen.qwen3-32b-v1:0`: 845 ms, `stopReason = tool_use`, valid tool input on the first try.
- `qwen.qwen3-vl-235b-a22b`: 1,254 ms text-only; 3,505 ms with one 910x1287 PNG page (1,567 tokens in, 102 out, about $0.0006). Extracted `INV-2026-0042` and `12450` with verbatim evidence quotes.
- Both models honour `toolChoice`, so the strict-JSON fallback is only a safety net (`llm.ts` still parses free text and runs one repair round when the zod parse fails).
- JSON schema for tools comes from `z.toJSONSchema` (zod 4) with `$schema` removed.

## SP8: ShipsGo (14:50) MOCK-ONLY
- No `SHIPSGO_API_KEY` exists yet. shipsgo.com/api-documentation is behind Cloudflare and refused the fetch, so the live request shape (v1.2 `PostContainerInfo` / `GetContainerInfo`, form `authCode`, `containerNumber`, `shippingLine`; `StatusId` 30/35/40/45/50/60) is written from the public docs and marked UNVERIFIED in `services/api/src/adapters/shipsgo.ts`.
- Mock fixtures in `data/fixtures/shipsgo/<CONTAINER>.json` follow the v1.2 response shape (recorded-style, labelled mock in logs and in the report). Fallback per PLAN 3.2: recorded fixture for the demo containers; other containers go to human review.
- When the key appears in `.env`, set `SHIPSGO_MODE=live`; no code change needed.

## SP9: Reflector FX feed (14:45) PASS with gaps
- Feed `CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W` on testnet: `decimals() = 14`, `base() = Other(USD)`.
- `assets()`: EUR, GBP, CHF, CAD, MXN, ARS, BRL, THB, XAU.
- `lastprice(Other(EUR))` = 1.1193 USD (ts 1792938900); GBP 1.3375; USD 1.0.
- **CNY, NGN and KES return None.** Fallback per PLAN 3.2 and 10.4: ECB (frankfurter) for CNY in the price check; local-currency amounts for NGN and KES are hidden. Recorded in `data/fixtures/reflector/`.

## SP-REG: GLEIF (14:40) PASS
- `GET https://api.gleif.org/api/v1/lei-records?filter[entity.registeredAs]=914403001922038216` answered in 0.5 s with LEI `300300G4NLFHF8PDPY52`, legal name `华为技术有限公司` (zh), alternative language legal name `Huawei Technologies Co., Ltd.` (en), entity ACTIVE, LEI ISSUED, country CN. Recorded in `data/fixtures/gleif/914403001922038216.json`; a miss (`91440300MA5FXXXX1A`) is recorded too.
- QCC: optional, only with `QCC_API_KEY`; the portal needs a login so the endpoint path is configurable and UNVERIFIED (`QCC_BASE_URL`, `QCC_EKYB_PATH`).

## SP-SANC: OpenSanctions (14:40) MOCK until a key exists
- `POST https://api.opensanctions.org/match/default` without a key answers `401 {"detail":"No API key provided."}`; the header is `Authorization: ApiKey <key>`. Live code is written for `algorithm=logic-v1&threshold=0.7&cutoff=0.5`.
- Mock mode: `data/fixtures/opensanctions/<slug>.json`, and a recorded-style empty response for names without a fixture.

## SP-FX: frankfurter (14:45) PASS
- `https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,EUR` answers (CNY 6.6702, EUR 0.89342 on 2026-10-23); `api.frankfurter.app` redirects there. NGN and KES are not offered.

## SP-X402 key (14:45)
- `curl https://channels.openzeppelin.com/testnet/gen` answered 201 with an API key; saved to `.env` as `X402_FACILITATOR_API_KEY`.

## SP7: x402 through the OZ facilitator (17:30) PASS up to settlement (needs USDC)
- `@x402/hono` + `@x402/core` + `@x402/stellar` 2.28.0; `x402ResourceServer(HTTPFacilitatorClient(channels.openzeppelin.com/x402/testnet, Bearer key)).register('stellar:testnet', ExactStellarScheme)`; `GET /supported` with the key answers `exact` v2 on `stellar:testnet` with `areFeesSponsored: true` (401 without the key).
- `POST /x402/v1/verify` unpaid answers `402` with `PAYMENT-REQUIRED` (amount 5000000 = 0.50 USDC, asset the testnet USDC SAC, payTo `GA2NU4TML6YCUVBWGQC3W3T2JNT3P7CZXEDXMJAQZVBZRLZ7J2LFGQ4G`, maxTimeoutSeconds 300).
- `examples/lender-agent` (`@x402/fetch` + `createEd25519Signer`) negotiates the 402 and builds the SAC transfer; the simulation fails with `Error(Contract, #10)` "resulting balance is not within the allowed range" because the payer `GB3SO7N4COXFBFPBYHLUJBG5KSTH6DUBSC2Y2O3TBXB25O6FMURGUGBI` holds 0 USDC. Both accounts have USDC trustlines. **Integrator: fund LENDER_AGENT_ADDRESS at https://faucet.circle.com (Stellar testnet), then `pnpm --filter @qafila/lender-agent start` settles and prints the signed report, the local check and the on-chain `verify_attestation` result.**
- Keys in `.env`: `X402_PAYTO_ADDRESS`, `X402_PAYTO_SECRET` (not used by the API), `LENDER_AGENT_SECRET`, `LENDER_AGENT_ADDRESS`.
