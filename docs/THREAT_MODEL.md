# Threat model

Written from PLAN.md section 11 and FLOWS.md, checked against the code on 25 October 2026. Testnet only during the event; see section 17 of the plan for what production adds.

## Assets at risk
- Investor money held by the contract per deal (`DealBalance`), importer security deposits (`PromiseHeld`, `Deal.security`), amounts owed to charity, treasury and refunds.
- The verifier key (signs listing and shipment attestations), the admin key, the agent key, the relayer key.
- Importer and supplier documents (personal and commercial data).
- The integrity of the AI decision (a wrong approve costs investors; a wrong reject costs the importer).

## Threats and mitigations

| Threat | Impact | Mitigation in this build | Where |
|---|---|---|---|
| Forged or altered documents | Funds paid for goods that do not exist | ISO 6346 and USCC check digits, arithmetic, dates and weights checks, cross-document consistency judged with evidence, registry (GLEIF, QCC when keyed), live carrier tracking matched to the loading event, human review before listing, supplier deposit capped at 30%, importer limits that grow only with on-time repayment, importer security deposit lost first | `services/api/src/pipeline/*`, contract `list_deal` caps |
| Same deal financed twice | Double exposure | Listing fingerprint (supplier code, invoice number, date, total, currency) and shipment fingerprint (carrier, B/L, containers) unique in the database and on-chain (`ListingFp`, `BlFp`) | contract `list_deal`, `confirm_shipment`; pipeline fingerprints |
| Verifier key stolen | Fake listings or shipment confirmations | Attestation bound to purpose, network id, contract address and deal id; ops still clicks List for every deal; `set_verifier` rotation; key only in `.env` on the API box; KMS in production | `packages/shared/src/attestation.ts`, contract `attest` module |
| Agent compromised | Premature supplier payment | Agent can only be `caller` of `pay_supplier_deposit` and `confirm_shipment`; a confirmation still needs a valid verifier signature; the agent smart account has a `CallContract(qafila_deals)` rule only; dry-run mode; every decision stored | contract role checks; `@qafila/chain` agent client; SP6 |
| Admin key stolen | Config changes, upgrades, aborts | Testnet single key; `pause` limits damage; every admin action emits an event; mainnet plan is a 2-of-3 multisig and announced upgrades | contract admin module |
| Prompt injection in documents | Manipulated decisions | Extraction-only prompts with the document as untrusted data, output only through the tool schema, evidence required per key field, decisions by the policy table not the model, packet 11 in the eval | `pipeline/prompts/*`, `pipeline/decide.ts` |
| Sanctioned parties or vessels | Legal exposure | OpenSanctions match on supplier, importer, legal representative when known, vessel by IMO; reject at 0.9, review from 0.7 | `adapters/opensanctions.ts` |
| Importer default | Investor loss | Security deposit lost first, then recoveries, then investors pro rata (FLOWS 5.5); limits start small; losses disclosed before investing; recoveries capped at what is owed | contract `finalize_default`, `deposit_recovery` |
| Supplier takes the deposit and does not ship | Partial loss | Deposit capped, registry and sanctions checks before payment, `abort_deal(true)` uses the importer's security for the actual loss only, FLOWS 5.2 | contract `abort_deal` |
| A deal stalls | Funds locked | `abort_deal` from Listed, Funded, DepositPaid or Owned; accept window; `cancel_unfunded` after the deadline; refunds and claims work while paused | contract |
| Charity or treasury address cannot receive | Repayment blocked | Amounts owed accrue in the contract and are paid by separate `sweep_*` calls; refunds likewise pulled with `withdraw_refund` | contract |
| Rounding or accounting bugs | Funds stuck or mispaid | Checked i128 math, floor division, per-deal balances, dust to charity on close, invariant property tests (1, 2, 3, 8, 9, 11 to 15), `claim` limited to indexed holders and to `funded` | `contracts/qafila_deals/src/test/*` |
| Storage entries expiring | Contract data unavailable | TTL extended on every write (1-day threshold, 7-day extension on testnet because rent is high; revisit before mainnet); runbook in `.shared/notes-chain.md`; archived entries restore on the next write | contract storage module |
| Personal data leak | GDPR breach | Private storage bucket with short signed URLs, ids only in logs, documents never shown to investors, server not reachable except through the API | API storage and logger |
| Secrets in git | Key theft | `.env` ignored, gitleaks in CI, testnet-only keys in env files, server env copied by hand | `.gitignore`, `.github/workflows/ts.yml` |
| API abuse | Cost blow-up | Rate limits per IP and user, file size and page caps, 24-hour adapter cache, x402 payment before work, no free retries | API middleware |
| Venue rush | Failed sign-ups | One submit queue per signing key with sequence refresh, faucet capped per wallet and per day, approvals retried from the job table | `@qafila/chain` `SubmitQueue`, jobs |
| Passkey domain change | Wallets stranded | Domain fixed to qafila.dev before H9 and read from `GET /config` | `APP_DOMAIN` |

## Known limits during the event
- Testnet rent is unusually high (2 to 30 XLM per write-heavy call), so keys must stay funded; `pnpm run doctor` checks balances.
- ShipsGo and OpenSanctions run in mock mode until keys arrive; the report labels every mock adapter.
- The agent signs as a plain G key with the agent role; the restricted smart account exists on-chain with the right rules and can be switched in with `set_agent`.
- No Sharia board review yet; the product is designed for compliance, review pending.
