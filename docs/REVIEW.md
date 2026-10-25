# Fresh-eyes review (Prompt E), 25 October 2026, 19:40 to 20:55 WET

Scope: `contracts/qafila_deals/src/*.rs`, `services/api/src/{auth,relayer}.ts`, `services/api/src/routes/*`, `services/api/src/jobs/agent.ts`, `services/api/src/pipeline/*` and prompts, `packages/chain/src/*`, `apps/web`, plus repo-wide greps. Read against PLAN 3.3.4 to 3.3.6, 5.5, 5.6, 11; FLOWS 5, 8 (invariants 11 to 15), A-1 to A-3; THREAT_MODEL.md. Branch `track/review`; the deployed contract interface is unchanged.

## Severity table

| Id | Severity | Where | Finding | Status |
|---|---|---|---|---|
| R-1 | High | `services/api/src/relayer.ts:73-77` (before fix) | Relayer "self call" allowlist bypass: any contract could be invoked at the relayer's expense | Fixed, `test/relayer.test.ts` |
| R-2 | Medium | `services/api/src/jobs/agent.ts:39-44` (before fix) | Agent A-1 gate counted `skipped` registry or sanctions checks as passed | Fixed, `test/agent-gate.test.ts` |
| R-3 | Medium | `services/api/src/routes/ops.ts:161` | Any ops approve-override sets `registry_override`, not only a registry one | Documented (needs a request-schema change) |
| R-4 | Low | `services/api/src/relayer.ts:104` and `lib/ratelimit.ts:20` | Per-IP limits key on `x-forwarded-for`, which a direct client can set | Documented |
| R-5 | Low | `services/api/src/auth.ts:51` | Dev bypass is also enabled by `ADAPTER_MODE=mock` outside production | Documented; deploy unit sets `NODE_ENV=production` |
| R-6 | Low | `contracts/qafila_deals/src/deal.rs:451,456` | `accept_window_secs` and `tenor_secs` are unbounded; saturating add can make a window never close | Documented (admin-signed terms) |
| R-7 | Low | `contracts/qafila_deals/src/deal.rs:643-672` | Recovery on an unsold defaulted deal is not capped at the loss; investors can receive more than principal | Documented (legitimate for owners; admin-only) |
| R-8 | Low | `services/api/src/lib/jwt.ts:60-63` | Tokens without `exp` or `aud` are accepted | Documented |
| R-9 | Low | `apps/web/components/ops/actions.tsx:55`, `deal-card.tsx:13` | Browser recomputes the supplier deposit amount and markup percentages from API amounts | Documented (display only, mirrors on-chain formula) |

No critical findings. No secrets, `any` types, `unwrap`/`expect` on untrusted values, or request-body logging found (details in "Checked and found clean").

## Findings

### R-1 (High, fixed): relayer sponsors any contract that is named in an auth entry
`relayerApp.checkFunc` let a call through when some auth entry's address equalled the invoked contract ("smart-account self call"). An auth entry is plain data until the invoked contract calls `require_auth` for that address, so an attacker deploys any contract (or picks any existing one that never calls `require_auth`), attaches an auth entry naming it, and the relayer pays the inclusion fee plus up to `RELAYER_MAX_RESOURCE_FEE` (default 50 XLM) per call, 30 calls a minute per IP. Consequence: the relayer key is drained and every venue sign-up and investment that relies on fee sponsorship fails; the allowlist in `allowedContracts` is meaningless.

Fix: a self call is sponsored only when the invoked contract's instance entry (`getLedgerEntries` on `ScVal::LedgerKeyContractInstance`) runs a wasm hash in `allowedWasmHashes` (the same list used for sponsored deployments). Results are cached for 60 s. With no `SMART_ACCOUNT_WASM_HASH` configured, self calls are refused, which is the safe default. `relayerApp` gained an optional `deps.rpc` so the test injects a fake RPC. Tests: `relayer allowlist` (four cases: foreign contract refused, unknown contract refused, allowed smart account sponsored, Qafila contract still sponsored without auth).

### R-2 (Medium, fixed): agent deposit gate accepted `skipped`
`checkStatus` only treated `fail`, `review` and `unavailable` as failures, so a report whose only registry check is `registry.lookup: skipped` (no company code on the licence or form) counted as "registry passed" for FLOWS A-1. The normal path still protects this (a skipped registry yields a `review` decision and ops must override, which sets the override flag anyway), but a deal that reaches `Funded` through `POST /ops/deals/import-onchain` or a hand-edited report would get its supplier deposit paid without a registry result. Fix: `gateChecks` requires every check with the prefix to be `pass`; it is exported and unit-tested.

### R-3 (Medium, documented): override conflates "approve" with "registry checked"
`POST /ops/deals/:id/override` with `decision: approve` sets both `ops_override` and `registry_override` whatever the reason. PLAN 5.6 says only "an ops override after a manual registry check counts as passed for the agent's deposit payment". An override granted for, say, a price-ratio review silently also unblocks the agent when the registry said "not found". Fix: add `registryChecked: boolean` to `OverrideRequest` (shared schema and web form), set `registry_override` from it, and show it in the audit row. Not done here because it changes the shared request schema and the ops UI.

### R-4 (Low): spoofable rate-limit keys
Both `clientIp` and the relayer read `x-forwarded-for` first. If the API is ever reachable without the proxy, a client sets the header and gets a fresh bucket per request. Fix: trust the header only when `TRUST_PROXY=true`, otherwise use the socket address (Hono `getConnInfo`).

### R-5 (Low): dev bypass condition is broad
`bypass = NODE_ENV !== 'production' && (DEV_AUTH_BYPASS || NODE_ENV === 'test' || ADAPTER_MODE === 'mock')`. The deploy unit (`deploy/qafila-api.service`) sets `NODE_ENV=production`, so it is off on the server. A developer who runs a public tunnel with `ADAPTER_MODE=mock` gives anyone `x-dev-roles: ops`. Fix: drop the `ADAPTER_MODE` clause and require `DEV_AUTH_BYPASS=true` explicitly.

### R-6 (Low): unbounded windows in `DealTerms`
`accept_window_secs` and `tenor_secs` have no upper bound; `owned_at.saturating_add(accept_window_secs)` with a huge value makes the accept window never close, and a huge tenor makes `mark_default` impossible. Terms are admin-signed and verifier-attested, so this needs two compromised keys. Fix (no interface change): add `max_accept_window_secs` and `max_tenor_secs` to `validate_terms` via `Config` when the config is next changed (a `Config` field addition is a type change, so bundle it with the next upgrade).

### R-7 (Low): unsold-deal recovery has no cap
`deposit_recovery` caps `principal_repaid + recovered <= sale_price` only when the deal was sold. For a deal aborted from `DepositPaid` or `Owned`, recoveries above `funded - DealBalance` raise `distributable` above `funded`, so holders receive more than principal. Since the investors own the goods, a resale above cost is a legitimate gain, and the call is admin plus payer authorised. Noted so the Sharia board sees it; cap at the loss if they object.

### R-8 (Low): JWT without `exp` or `aud` accepted
Supabase always sets both, so this only matters for a secret leak plus a hand-minted token. Fix: require `exp` and `aud` when `audience` is given.

### R-9 (Low): browser arithmetic
`ops/actions.tsx:55` computes `cost * depositBps / 10000` and `deal-card.tsx` derives bps from amounts. They match `math::bps_floor`, are display-only, and the API already returns the on-chain amounts after the call. Prefer showing the amount the contract returned (`tx.result`) once paid.

## Checked and found clean

Contract (`deal.rs`, `admin.rs`, `attest.rs`, `share.rs`, `storage.rs`, `math.rs`):
- Order inside every function is pause, state, auth, validate, storage, token calls, event; every state change emits an event; `storage::put` extends TTL on every persistent write and `extend_instance` runs at every entry point.
- All `i128` arithmetic goes through `math::*` checked helpers or `checked_*`; `u64` time arithmetic saturates. No `unwrap`/`expect` outside tests.
- Invariants: 4 (`sale_price` set once in `accept_murabaha`), 5 (late fees only touch `CharityOwed`), 6 (every function checks the exact source state), 7 (`invest` requires `Investor(addr)` and refuses the importer), 8 (`platform_fee <= markup` enforced), 9 (`distributable = DealBalance` at `cancel`, `repay` completion, `finalize_default`), 10 (listing fp, B/L fp, share token marked and checked), 11 (`finalize_default` uses `min(security, funded - balance)` and refunds the rest), 12 (`deposit_recovery` cap for sold deals), 13 (`extend_due` once, bounded, price untouched), 14 (refunds credit `terms.importer` only; `withdraw_refund` pays the key it reads), 15 (security zeroed at cancel, abort-not-at-fault, accept, finalize).
- Claim guard (previous fix): holder must be in the index, `claimed_shares` never exceeds `funded`, payout floors, clawback before transfer.
- Pause: `cancel_unfunded`, `claim`, `close_deal`, sweeps, `withdraw_promise`, `withdraw_refund`, views and admin functions work while paused; everything else returns `Paused`.
- Attestation message is byte-for-byte PLAN 3.3.6 (prefix, u32 purpose, `network_id`, contract address XDR, u64 deal id, payload hash); LIST binds the terms including the fingerprint and security; SHIPPED binds the deal id; the golden vectors test ties Rust to TypeScript.
- Share-token probe matches PLAN 3.3.4 and also checks the balance returns to 0.
- `holders` is bounded by `limit <= 50`; there is no loop over holders anywhere else.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (49 tests) green; nothing changed in the contract.

Pipeline:
- `decide.ts` is a pure function over facts and matches PLAN 5.6 rule for rule (reject list, review list, approve otherwise); the LLM contributes only `match`/category judgments that enter as facts; halal verdicts come from the policy table, price comparison is deterministic, the name judge only feeds a `review`.
- Prompts: every prompt states that document text is untrusted; extraction is tool-only with evidence per field; hidden text is copied to `hidden_or_suspicious_text` and surfaced as a check; extracted strings reach the consistency, halal, price and name-match prompts as labelled data lines inside a fixed frame, never as instructions.
- Evidence: `auditKeyFields` zeroes confidence for a value without evidence and counts it missing; `< 0.8` sends to review.
- Fingerprints: listing = supplier key, invoice number, date, total, currency; shipment = carrier, B/L, sorted containers; checked in the store and on-chain.
- Report: RFC 8785 canonical JSON, sha256, purpose 10 with deal id 0; SHIPPED signed with the deal id.
- Registry chain: QCC (when keyed), GLEIF live, fixture fallback labelled `registry fixture (mock)` with `mode: 'mock'` in the report.

API:
- Every `/ops/*` route goes through `requireUser(c, 'ops', 'sharia')`; every importer deal route uses `assertOwnerOrOps`; `GET /deals`, `GET /deals/:id`, `/tracking`, `/stats`, `/events`, `/charity` are public by design.
- `Bearer mock.<address>` is anonymous; `/auth/dev-otp` and `/auth/dev-token` 404 in production; the deploy unit sets `NODE_ENV=production`.
- Uploads: mime sniffed from bytes, 15 MB cap, sha256 recomputed server-side and compared with the registered hash on `PUT`, 20-page cap in `ingestDocument`, rejected files cannot be resubmitted.
- Listing gate in `listDealOnChain`: rejected never, review only with an override, wallet, payout address and on-chain promise required.
- Agent: A-1 (payout address, registry and sanctions pass or override, no open incident, supplier confirmation under the flag), A-2 (report decision `approve`, which requires `dealStructureOk` and loading-vessel match, no open incident, fingerprint present, verifier signature over the deal id), A-3 (sweep, refunds from `refund_owed` events, claims after the delay, close).
- Secrets: no `S...` strkeys in code or docs; no `console.log` of bodies (only the eval and migrate CLIs print); logs carry ids and hashes.

Chain package:
- `SubmitQueue`: one queue per public key via the process-wide registry, sequence reloaded on every attempt, `txBAD_SEQ` and `TRY_AGAIN_LATER` retried with linear backoff.
- Share-token factory follows PLAN 3.1 steps 1 to 8: random issuer, 2 XLM funding, `AUTH_REQUIRED | AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED` plus home domain, SAC deploy by the funder, `set_admin(contract)`, master weight 0, Horizon verification of flags, weight and signer count; the issuer secret only lives inside the call and goes to the CLI through the environment, never argv.
- Attestation wrappers check payload lengths and use the shared message builder.

Web:
- No contract id, network passphrase or explorer network hard-coded; all come from `GET /config`.
- `rpIdFor` uses the configured rpId only when the page host is it or a subdomain; otherwise it falls back to the page host with a warning, which keeps a mismatched preview working but means passkeys made there are bound to that host.
- `strict` TypeScript, no `any` (the only hit is a comment).

## What the integrator needs to do
- No contract upgrade is needed: nothing in `contracts/` changed and no high finding is in the contract.
- Deploy the API from this branch (R-1, R-2). Confirm `SMART_ACCOUNT_WASM_HASH` is set in the server env; with it unset the relayer now refuses smart-account self calls instead of sponsoring everything.
- Decide R-3 before real money (schema change, small).
