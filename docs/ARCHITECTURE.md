# Architecture

Built 25 to 26 October 2026 for HackMeridian. The specification is `PLAN.md` with the v1.1 delta in `FLOWS.md`; this file records what was actually built and the decisions that differ from the plan.

## Components

```
 Browser (Next.js 16 on Vercel, qafila.dev)
   passkey smart account (smart-account-kit 0.8.0, OpenZeppelin accounts, SDF relayer proxy for sponsored fees)
   Freighter via Stellar Wallets Kit for ops and G-address investors
      |  HTTPS, JSON validated with zod on both sides (packages/shared)
      v
 API (Hono on Node 22, AWS EC2 eu-west-1, api.qafila.dev behind Caddy)
   routes (PLAN 8.1 + FLOWS 9)        pipeline (extract, validate, judge, decide, report, sign)
   jobs worker (same process)         shipment agent (dry-run then live)
   indexer (getEvents every 5 s)      x402 verification API (flag)
      |                                   |
      | postgres / storage / auth         | Bedrock Converse (Qwen3-VL 235B, Qwen3 32B), GLEIF, ShipsGo,
      v                                   | OpenSanctions, Reflector, ECB rates, Resend
 Self-hosted Supabase on the same box (Postgres, GoTrue, Storage, Inbucket), not reachable from the internet
      |
      v
 Stellar testnet (protocol 29)
   qafila_deals (soroban-sdk 28): murabaha lifecycle, security deposits, attestations, holder index
   qUSD test stablecoin SAC (settlement), one locked-issuer share asset per deal (QF0000000n)
   agent smart account with a CallContract(qafila_deals) rule
```

## Repository

Monorepo with pnpm workspaces: `apps/web`, `services/api`, `packages/shared` (schemas, attestation encoding, promise text), `packages/chain` (share-token factory, submit queue, contract call helpers, attestation signing, deployment files), `packages/contract-client` (generated, never edited), `contracts/` (Rust workspace: `qafila_deals`, spike contracts), `scripts/` (deploy, seed, demo-reset, e2e-chain, doctor, golden vectors, bindings), `data/` (price table, demo packets, fixtures, golden vectors), `deployments/` (testnet instances), `deploy/` (server unit and script), `docs/`.

Three engineers worked in parallel in git worktrees (`track/chain`, `track/intel`, `track/product`), handing artefacts over through an untracked `.shared/` folder; the integrator merged into `main`.

## Decisions that differ from the plan

| Topic | Plan | Built | Why |
|---|---|---|---|
| LLM | Anthropic API, Bedrock as alternative | AWS Bedrock with Qwen3-VL 235B (vision) and Qwen3 32B through the Converse API with forced tool use | Ilyes's decision; AWS account available; PDFs are rasterised with poppler and sent as page images, text layer kept as a second channel |
| Supplier registry | Topograph | GLEIF live (free, no key), QCC when keyed, fixtures in mock mode | Topograph needed a key and up to 7 minutes; GLEIF answers at once |
| Database and files | Hosted Supabase | Self-hosted Supabase stack on the API box | Hosted free tier was full; the API proxies auth so the stack stays private |
| API hosting | Railway or Fly.io | AWS EC2 with Caddy and an IAM role for Bedrock | AWS account available |
| soroban-sdk | latest | 28.0.0 | OpenZeppelin stellar-* 0.8.0 pin ^28; protocol 28 wasm runs on testnet's protocol 29 |
| Storage TTL | about 30 days | 1-day threshold, 7-day extension | Testnet rent made 30 days cost about 31k XLM per deal; revisit before mainnet |
| Agent signer | smart account | G key holds the agent role; the smart account exists with the right rules and can be switched in with `set_agent` | SP6 passed; the kit needs SDK 16 while the API uses SDK 17, so the switch is a follow-up |
| Trustless Work escrow | SHOULD S2 | Not started, flag off | No API key during the event; the contract is escrow-agnostic (`PaymentMode`) |

## Data flow for one deal

1. Importer creates a draft, uploads invoice, packing list and licence (signed upload URLs, private bucket).
2. `verify_listing` job: extraction with evidence per key field, deterministic validators, registry and sanctions, price check, halal screen, consistency judge, fingerprints, decision policy, canonical report, `report_hash`, REPORT attestation, plain explanation.
3. Importer reads the promise text (versioned template in `packages/shared/src/promise.ts`), signs `promise_purchase` with the passkey, which locks the security deposit.
4. Ops lists: share-token factory (fresh issuer, flags, SAC, admin to the contract, master weight 0), LIST attestation over the DealTerms XDR, `list_deal` (which probes the share token and checks the promise).
5. Investors invest (locked shares minted 1:1, holder index), the co-invest account takes 5%.
6. Agent pays the supplier deposit; importer uploads the B/L; `verify_shipment` job and the agent match the carrier loading event, sign SHIPPED, call `confirm_shipment`, the balance is paid.
7. Importer signs `accept_murabaha` (security counted as the first payment), repays, pays a late fee to charity if late; investors claim; `close_deal` sends dust to charity; the agent sweeps.
8. The indexer stores every event; the web app reads merged off-chain and on-chain state from the API and links every transaction to stellar.expert.

## Environments

| Env | Where | Notes |
|---|---|---|
| local | Mac, `supabase start`, local Stellar quickstart container for `pnpm e2e:chain` | mock adapters |
| testnet | qafila.dev (Vercel), api.qafila.dev (EC2), contract `CAJW4MIEZXIUFHGLQISXLDF3XIHJOLGSKGDQQHBIQJ2BJU34ZT3COSPV` (main) and a separate e2e instance | qUSD test dollars; Circle testnet USDC only for x402 |
| mainnet | not used during the event | section 13.3 of the plan |
