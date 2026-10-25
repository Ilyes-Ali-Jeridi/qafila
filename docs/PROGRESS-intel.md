# Progress log, Track B (intelligence)

Times are WET (Lisbon). H0 = Sun 25 Oct 2026 09:00. Branch `track/intel`, worktree `.worktrees/intel`.

## Sun 25 Oct

- 14:35 (H5.5) Read CLAUDE.md, PLAN.md, FLOWS.md, KICKOFF_PROMPTS.md, PROGRESS.md and the scaffold. Baseline `pnpm test` (15 tests) and `pnpm -r typecheck` green. Local Postgres: `docker run -d --name qafila-pg -p 5433:5432 -e POSTGRES_PASSWORD=qafila postgres:16`.
- 14:45 (H5.75) Spikes: Bedrock Qwen tool use PASS in eu-west-1 (both models honour `toolChoice`); Reflector testnet FX has EUR/GBP/CHF/CAD/MXN/ARS/BRL/THB/XAU only, no CNY/NGN/KES (fallback: ECB for CNY, hide NGN/KES); GLEIF live PASS (Huawei ACTIVE); OpenSanctions needs a key (mock); frankfurter v1 PASS; OZ Channels testnet key generated and saved. Details in `docs/SPIKES-intel.md`.
  - `.env` additions (shared file): `AWS_REGION=eu-west-1`, `LLM_PROVIDER=bedrock`, model ids, `ADAPTER_MODE=live`, `REGISTRY_MODE=live`, `SHIPSGO_MODE=mock`, `OPENSANCTIONS_MODE=mock`, local `DATABASE_URL`, `X402_FACILITATOR_URL`, `X402_FACILITATOR_API_KEY`.
- 15:20 (H6.3) Adapter layer: `services/api/src/adapters/base.ts` (one shape for every adapter: zod-validated response, 10 s timeout, 2 retries with backoff, 24 h cache by request hash, mock replay from `data/fixtures/<adapter>/`, live responses recorded as fixtures), `llm.ts` (Bedrock Converse tool use, forced tool choice, temperature 0, zod parse plus one repair round, free-text JSON fallback, Anthropic Messages path kept behind `LLM_PROVIDER=anthropic`, fixtures by stable cache key for offline eval), `gleif.ts`, `qcc.ts` (optional), `fx.ts`, `reflector.ts`, `opensanctions.ts`, `shipsgo.ts`, `resend.ts` (log-only without a key), `storage.ts` (Supabase Storage or local disk with HMAC-signed URLs), `index.ts` (modes from env). Live fixtures recorded for GLEIF, FX and Reflector. Tests: `services/api/test/adapters.test.ts`.
