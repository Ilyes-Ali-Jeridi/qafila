# Qafila API runbook (Track B)

Hono on Node 22, one process that also runs the job loop. Postgres (self-hosted Supabase) through Drizzle, documents in Supabase Storage (bucket `documents`, private) or on local disk, AWS Bedrock (Qwen) for the AI pipeline, Stellar testnet through `@qafila/chain`.

## Run

```bash
pnpm install
pnpm --filter ./services/api db:migrate          # DATABASE_URL from .env
pnpm --filter ./services/api dev                 # API on PORT (8787) with WORKER=true from .env
pnpm --filter ./services/api worker              # the job loop on its own (optional second process)
pnpm --filter ./services/api test                # unit + flow tests (flow needs DATABASE_URL)
pnpm eval                                        # 12 packets, mock mode (offline); ADAPTER_MODE=live LLM_MODE=live for Bedrock
pnpm --filter @qafila/lender-agent start         # x402 buyer demo (needs USDC on LENDER_AGENT_ADDRESS)
```

Production (EC2): `NODE_ENV=production WORKER=true STORAGE_MODE=supabase` with `/opt/qafila/.env`; `pm2 start "pnpm --filter ./services/api start" --name qafila-api` (poppler-utils installed for `pdftoppm` and `pdftotext`).

## Environment (see `.env.example` for every key)

| Group | Keys | Notes |
|---|---|---|
| Chain | `STELLAR_NETWORK`, `STELLAR_RPC_URL`, `NETWORK_PASSPHRASE`, `QAFILA_CONTRACT_ID`, `SETTLEMENT_TOKEN_ID/CODE/ISSUER`, `ADMIN_SECRET`, `VERIFIER_ED25519_SECRET`, `AGENT_SIGNER_SECRET`, `AGENT_SMART_ACCOUNT_ID`, `SHARE_ISSUER_FUNDER_SECRET`, `FAUCET_SECRET`, `CHARITY_ADDRESS`, `TREASURY_ADDRESS`, `RELAYER_SECRET`, `RELAYER_URL`, `SMART_ACCOUNT_WASM_HASH`, `WEBAUTHN_VERIFIER_ADDRESS`, `APP_DOMAIN` | `deployments/<network>.json` fills contract id, tokens and verifier key when env is empty; `CHAIN_MODE=mock` runs an in-memory chain |
| Database and auth | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `STORAGE_MODE`, `INBUCKET_URL` | The browser never talks to Supabase: `POST /auth/otp`, `POST /auth/verify` |
| AI | `LLM_PROVIDER=bedrock`, `AWS_REGION=eu-west-1`, `LLM_MODEL_REASON`, `LLM_MODEL_FAST`, `LLM_MODE` | AWS credentials from `~/.aws` or the instance role |
| External data | `SHIPSGO_API_KEY` + `SHIPSGO_MODE`, `OPENSANCTIONS_API_KEY` + `OPENSANCTIONS_MODE`, `QCC_API_KEY` (optional), `REGISTRY_MODE`, `REFLECTOR_FX_ID`, `FX_FALLBACK_URL`, `RESEND_API_KEY` | Without a key an adapter runs in mock mode (labelled in logs and in the report); set `*_MODE=live` once the key exists, no code change |
| x402 | `X402_FACILITATOR_URL`, `X402_FACILITATOR_API_KEY`, `X402_PAYTO_ADDRESS`, `X402_PRICE_USDC`, `FF_X402` | OZ Channels testnet; payTo needs a USDC trustline |
| Economics | `MARKUP_BPS`, `PLATFORM_FEE_BPS`, `LATE_FEE_BPS`, `SUPPLIER_DEPOSIT_BPS`, `FUNDING_WINDOW_SECS`, `ACCEPT_WINDOW_SECS`, `MIN/STEP/FLOOR_SECURITY_BPS`, `MAX_EXTENSION_SECS`, `FAUCET_AMOUNT` | Caps are enforced on-chain |
| Switches | `WORKER`, `AGENT_DRY_RUN`, `DEV_AUTH_BYPASS`, `FF_*` | `DEV_AUTH_BYPASS` never applies in production |

## Auth

- Session: `Authorization: Bearer <GoTrue access token>` from `POST /auth/verify` (HS256, `SUPABASE_JWT_SECRET`; ES256/RS256 through the JWKS endpoint when no secret is set).
- Wallet-only (testnet join, faucet, portfolio): `X-Wallet-Address: G...|C...` (display identity only, never for funds).
- Non-production tests: `x-dev-user: <id>`, `x-dev-roles: importer,ops`, `x-dev-email`; `POST /auth/dev-token` mints a session token; `GET /auth/dev-otp?email=` reads the last code from the local mail catcher.
- Roles `investor`, `importer`, `ops`, `sharia` live on `profiles.roles`; ops and sharia are granted in the database.

## Routes

Public: `GET /health`, `GET /config`, `GET /.well-known/qafila-verifier.json`, `GET /stats`, `GET /events?limit=`, `GET /charity`, `GET /deals`, `GET /deals/:id` (uuid or number), `GET /deals/:id/tracking`, `GET /jobs/:id`, `GET /files/*` (local storage links), `GET|POST /supplier/confirm/:token` (`FF_SUPPLIER_CONFIRM`).

Session: `POST /auth/otp`, `POST /auth/verify`, `GET /me`, `GET /me/portfolio`, `POST /wallet/link`, `POST /kyc`, `POST /join`, `POST /faucet`, `POST /kyb`, `POST /kyb/documents`.

Importer: `POST /deals`, `PATCH /deals/:id`, `GET /deals/:id/documents`, `POST /deals/:id/documents` (JSON registration then `PUT /deals/:id/documents/:docId` with the bytes, or multipart `type` + `file`), `POST /deals/:id/verify` (job), `GET /deals/:id/report?stage=`, `POST /deals/:id/promise`, `POST /deals/:id/promise/submitted`, `POST /deals/:id/shipment` (job), `GET /importer/deals`, `GET /importer/deals/:id`, `POST /deals/:id/extension-request`, `GET /deals/:id/purchase-order`, `GET /deals/:id/tradefile`.

Ops: `GET /ops/queue`, `GET /ops/deals/:id`, `POST /ops/deals/:id/{list,pay-deposit,confirm-shipment,abort,override,default,recovery,recovery-note,finalize,extend,refuse-extension,release-bl,incident}`, `POST /ops/deals/import-onchain` (adopt a seeded on-chain deal), `GET /ops/kyc`, `POST /ops/kyc/:id/approve` (investor: `approve_investor`; importer: KYB plus the 1.35 x limit faucet grant), `GET /ops/agent`, `GET|PUT /ops/policy`, `POST /ops/incidents/:id/resolve`.

x402 (`FF_X402`): `POST /x402/v1/verify` (paid, multipart `form` JSON + `invoice`, `packing_list`, `business_licence`, optional `bill_of_lading`; returns `{ job_id, job_token }`), `GET /x402/v1/jobs/:id?job_token=` (signed report, purpose 10).

Relayer: `POST /relayer` (`RELAYER_SECRET`), the smart-account-kit proxy protocol.

Every error is `{ error: { code, message, details? } }`; every amount is an i128 stroop string.

## Jobs

`verify_listing`, `verify_shipment`, `x402_verify`, `agent_tick` (every 10 min and on `funded`, `repaid`, `late_fee_to_charity`, `refund_owed`, `closed`, aborts, B/L verification), `index_tick` (every 5 s; `getEvents` with a stored cursor, backfill from about a day back or `INDEXER_START_LEDGER`), `notify`, `approve_investor`, `faucet_grant`. Five attempts with exponential backoff; dead jobs appear in `GET /ops/agent`.

## Agent (PLAN 6, FLOWS A-1 to A-3)

Pays the supplier deposit on `Funded` deals when the payout address is on record, registry and sanctions passed (or ops overrode the registry after a manual gsxt.gov.cn check), no incident is open and, with `FF_SUPPLIER_CONFIRM`, the supplier accepted. Confirms a shipment only when the shipment-stage report is `approve` (B/L to order of Qafila, loading event matches the B/L vessel, fingerprint unused), signing the SHIPPED attestation (purpose 2). Sweeps charity when something is owed, sends refunds after `refund_owed`, claims for holders 24 h after a deal becomes claimable (`AGENT_CLAIM_DELAY_MS`), closes when every share is claimed. `AGENT_DRY_RUN=true` records every decision without submitting. The on-chain agent role is the plain G key; signing as the agent smart account is the next step (sp6.md).

## Verification pipeline

`services/api/src/pipeline/`: intake (poppler), extraction (Bedrock Qwen VL, tool use, evidence per field), deterministic validators (PLAN 5.3), consistency judge, halal screen over the policy table, price check (Reflector then ECB), registry chain (USCC check digit, QCC when keyed, GLEIF, fixtures in mock), OpenSanctions, ShipsGo tracking, fingerprints, decision policy (`decide.ts`, pure), canonical report (RFC 8785) signed with purpose 10, explanation. `pnpm eval` prints the table and writes `data/eval-output/`.
