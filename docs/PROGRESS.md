# Progress log

Times are WET (Lisbon). H0 = Sun 25 Oct 2026 09:00.

## Sun 25 Oct

- 10:55 (H2) Read CLAUDE.md, PLAN.md, KICKOFF_PROMPTS.md. Machine check: node 25.2.1, pnpm 10.26.2, rustc 1.93.1, docker 29.9, gh/vercel/supabase/wrangler logged in. Missing: stellar CLI, wasm32v1-none, Raven, Trustless Work skill.
- 12:50 (H4) FLOWS.md v1.1 added and wired into PLAN.md, CLAUDE.md and KICKOFF_PROMPTS.md. Topograph replaced by the GLEIF registry chain (GLEIF live, QCC optional, fixtures in mock). First commit pushed to the private repo github.com/Ilyes-Ali-Jeridi/qafila.
  - Machine issue: `git init` fails with EPERM in new folders under ~/Desktop. Repo data lives at `~/.qafila.git` (`--separate-git-dir`); the project folder holds a pointer file.
- 13:05 (H4) Tools installed: stellar CLI 28.1.0, wasm32v1-none. Raven MCP registered for future sessions (OAuth pending, this session uses the stellar-dev skills).
  - Testnet and mainnet both run protocol 29. The CLI is 28.1 and OpenZeppelin stellar-contracts 0.8.0 pins soroban-sdk ^28, so the contract uses **soroban-sdk 28.0.0** (protocol 28 wasm runs on 29). Latest sdk is 29.0.1; upgrade after the event if OZ catches up.
  - AI provider decision (Ilyes, 13:00): **AWS Bedrock with Qwen**, not Anthropic. Account 324037291272, us-east-1. Verified with a live Converse call: `qwen.qwen3-vl-235b-a22b` (text + image) for extraction and judgments, `qwen.qwen3-32b-v1:0` for classification. PDFs are rasterised to page images before extraction; text layers are kept as a second channel.
  - Hosting decision: API on AWS EC2 (us-east-1) at api.qafila.dev, web on Vercel at qafila.dev, DNS on Cloudflare (zone active). Passkey domain fixed: qafila.dev.
  - Pinned versions: next 16.4.3, react 19.3.1, hono 4.13.14, drizzle-orm 0.45.4, zod 4.6.7, vitest 5.0.5, @playwright/test 1.64.1, smart-account-kit 0.8.0, @stellar/stellar-sdk 17.4.0, @x402/stellar 2.28.0, OZ stellar-access / stellar-contract-utils / stellar-tokens 0.8.0, proptest 1.12.0.
- 13:30 to 14:20 (H4 to H5) Scaffold written: workspace, .env.example, contract interface stub (compiles, wasm 19 KB, 1 smoke test), probe spike contract, TypeScript bindings, packages/shared (schemas, documents, report, attestation, promise text, tests), API skeleton (health, config, well-known live; every other PLAN 8.1 route answers 501), Drizzle schema, web skeleton (tokens, layout, landing, route files with loading and error states), CI workflows.
  - Venue Wi-Fi: about 100 KB/s, frequent ECONNRESET, IPv6 unreachable. `pnpm install` stalled for 20 minutes. Fix: pin exact versions already in the local pnpm store, `prefer-offline`, `NODE_OPTIONS=--dns-result-order=ipv4first`. Phone hotspot recommended for deploys (PLAN 18).
