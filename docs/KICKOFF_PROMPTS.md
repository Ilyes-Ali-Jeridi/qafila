# Kickoff prompts for Claude Code

Copy each prompt into the right Claude Code session at the right time. The sessions read `CLAUDE.md` and `docs/PLAN.md` automatically once those files are in the repo.

## One-time setup (before Sunday, on your machine)

```bash
# Raven (Stellar MCP), remote, OAuth in the browser on first use
claude mcp add --transport http raven https://raven.stellar.org/mcp

# Trustless Work skill (run in the repo folder)
npx skills add trustless-work/trustlesswork-skill
```

Inside Claude Code:
```
/plugin marketplace add stellar/stellar-dev-skill
/plugin install stellar-dev@stellar-dev
```

Optional `.claude/settings.json` in the repo so long runs do not stop for every command. Keep mainnet out of it.
```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm:*)", "Bash(cargo:*)", "Bash(stellar contract build:*)",
      "Bash(stellar contract bindings:*)", "Bash(git add:*)", "Bash(git commit:*)",
      "Bash(git status:*)", "Bash(git diff:*)", "Bash(npx playwright:*)", "Bash(docker:*)"
    ],
    "deny": ["Bash(*mainnet*)", "Bash(git push --force:*)"]
  }
}
```

---

## Prompt 0: scaffold (Sunday 09:00, one session in the empty repo)

```
You are building Qafila for HackMeridian. Read CLAUDE.md, docs/PLAN.md and docs/FLOWS.md completely before doing anything. FLOWS.md wins over PLAN.md.

1. Check tools: node 22, pnpm, rustup with wasm32v1-none, stellar CLI, docker. Use Raven to find the current stable versions of soroban-sdk, the OpenZeppelin stellar-contracts crates we need (access control, pausable, upgradeable), smart-account-kit and the x402 Stellar packages. Record exact versions in docs/PROGRESS.md.
2. Scaffold the monorepo exactly as PLAN.md section 2.3. Add .env.example from section 2.5.
3. packages/shared: zod schemas for DealTerms, DealState, Deal, the four document types (invoice, packing list, business licence, bill of lading) with evidence and confidence per key field, the verification report, the shipment report, and attestation encoding helpers (section 3.3.6).
4. contracts/qafila_deals: types, storage keys, errors and every function signature from section 3.3.4 plus the FLOWS.md section 8 delta (security in DealTerms, Deal and PromiseRecord; withdraw_promise, withdraw_refund, extend_due, required_security, refund_of), including the `caller: Address` first argument on functions two roles may call, with bodies that return an error for now. It must compile. Build the wasm and generate TypeScript bindings from it with `stellar contract bindings typescript --wasm <path> --output-dir packages/contract-client --overwrite`, so Tracks B and C can code against real types.
5. services/api: Hono app with every route from section 8.1 returning 501 for now except GET /health and GET /config (network, contract id, tokens, flags, read at runtime by the web app), zod validation wired, Drizzle schema from section 8.2 and the first migration.
6. apps/web: Next.js app with the layout, design tokens from section 9.1, the testnet badge and empty route files from section 2.3. No placeholder buttons on any page.
7. GitHub Actions skeletons from section 12.
8. Commit "chore: scaffold" and push.
9. Create three worktrees on new branches: ../qafila-chain (track/chain), ../qafila-intel (track/intel), ../qafila-product (track/product).
Stop when done and print the worktree paths.
```

---

## Prompt A: chain track (Sunday 10:00, in ../qafila-chain)

```
You own Track A in docs/PLAN.md (sections 3, 4.1 SP5 with Track C, 10.1, 10.2, 13.1 steps 2 and 7) and docs/FLOWS.md section 8 plus items 1 and 2 of section 10. FLOWS.md section 8 is part of M1: build it into qafila_deals from the start, with its tests, invariants, golden vectors and bindings.

Order:
1. In the first 30 minutes, deploy contracts/spikes/probe to testnet (one function: require_auth on a caller plus a SAC transfer) and post its id in docs/SPIKES.md so Track C can run SP5 and Track B can prepare SP6.
2. Protocol spikes SP1, SP2, SP3, SP4, SP6, SP11, SP12 from section 3.2 on testnet. Ask Raven before each one. Write PASS or FAIL with transaction hashes in docs/SPIKES.md. On FAIL, adopt the fallback and say so in docs/PROGRESS.md.
3. Implement qafila_deals fully per section 3.3: promise, listing probe, caller-checked agent functions, abort path, owed amounts with separate sweeps, verify_attestation (traps on invalid). Write every test in 3.3.7 and the invariants in 3.3.5 as proptests. cargo test must be green.
4. scripts/share-token.ts (section 3.1 factory), scripts/deploy-testnet.ts (issues qUSD, supports --instance e2e), scripts/seed.ts (the three demo deals), scripts/demo-reset.ts (never redeploys), scripts/golden-vectors.ts, pnpm bindings.
5. Deploy to testnet, regenerate bindings, commit deployments/testnet.json and deployments/testnet-e2e.json.
6. scripts/e2e-chain.ts on a local network with G keypairs: full lifecycle, late fee and sweep, abort, default, cancel.
Only after all of that is green: S2 Trustless Work escrow mode (3 hour timebox, use the Trustless Work skill), then C1 if Ilyes says so.
Commit after every green step. Update docs/PROGRESS.md with the time and what changed.
```

---

## Prompt B: intelligence track (Sunday 10:00, in ../qafila-intel)

```
You own Track B in docs/PLAN.md (sections 5, 6, 7, 8) and docs/FLOWS.md sections 5, 6, 8, 9 plus items 3 and 4 of section 10.

Order:
1. Adapters from section 5.4 with live and mock modes and zod-validated responses. Record real responses into data/fixtures as you test them live. Run SP8 (ShipsGo) and SP9 (Reflector FX) and record results in docs/SPIKES.md.
   Registry is a chain, not Topograph (which is gone): services/api/src/adapters/gleif.ts (live, no key: GET https://api.gleif.org/api/v1/lei-records?filter[entity.registeredAs]=<USCC>, map to { found, lei, legalNameZh, legalNameEn, entityStatus, leiStatus, registeredAt, lastUpdate, address }, require legalAddress.country == CN, cache 24 h in external_calls, record real responses into data/fixtures/gleif/; Huawei 914403001922038216 is a known ACTIVE hit). Optional adapters/qcc.ts only if QCC_API_KEY is set (CN eKYB endpoint, ApiKey, Timespan, Token headers per developer.qcckyc.com; no key: skip silently). Mock fixtures in data/fixtures/registry/ for the fictional demo suppliers and packet 08, labelled mock in logs and report. pipeline/registry.ts: USCC check digit, then QCC if configured, then GLEIF, then fixture in mock mode; Chinese name exact match after normalising full-width characters and brackets; English name by LLM judge with evidence. Decision: INACTIVE, revoked or deregistered reject; not found, LEI lapsed or name mismatch review with a gsxt.gov.cn link in the ops view; found, ACTIVE, ISSUED and name match pass; an ops override after a manual check counts as passed for the agent's deposit payment (audit log). No topograph adapter, no topograph_poll job, no TOPOGRAPH_* env; REGISTRY_MODE=live|mock and QCC_API_KEY= in .env.example.
2. Extraction for invoice, packing list and business licence, then bill of lading (section 5.2), with prompts as versioned files and the injection rules in 5.5.
3. Deterministic validators in 5.3 with the exact test vectors.
4. Consistency judge, halal screen, price check, fingerprint, decision policy (5.6), canonical report, signing with purpose 10.
5. pnpm eval over data/packets; reach 12 of 12 (section 5.7). Print the table.
6. Database, routes (8.1), indexer (8.3), jobs (8.4), notifications (8.5).
7. Shipment agent (section 6): deposit payment on funded deals, shipment confirmation from the loading event, housekeeping sweeps and claims; triggered by indexer events and B/L uploads plus a 10-minute tick. Dry-run first, then live against the agent smart account from Track A.
8. S1 x402 verification API and examples/lender-agent (section 7, 2 hour timebox): the paid call settles and returns a job id; results come from the free job endpoint. Then S3 Reflector in the price check.
Never let the LLM decide alone. Commit after every green step and update docs/PROGRESS.md.
```

---

## Prompt C: product track (Sunday 10:00, in ../qafila-product)

```
You own Track C in docs/PLAN.md (sections 4, 9, 12 e2e, 15) and docs/FLOWS.md sections 4, 5, 6, 9 plus item 5 of section 10 (promise step with the security deposit, "If things go wrong" box, sign-sale amounts, "Money to collect", abort reason picker, Playwright). Every amount comes from the contract or the API, never hard-coded.

Order:
1. Passkey onboarding with smart-account-kit (section 4.1) and SP5 against Track A's probe contract: create wallet, connect, call the probe on testnet with sponsored fees. Record the result in docs/SPIKES.md. Agree the production domain with Ilyes before H9 (passkeys are bound to it).
2. Landing with live stats, marketplace, deal detail, invest, portfolio and claim (section 9.2), first against the API contract from packages/shared with a local mock server, then the real API.
3. Importer wizard, shipment step, sign sale, repay.
4. Ops console.
5. Public deal page, charity ledger, verifier page.
6. S6 /join QR flow; then S5 trade file and S4 trade passport.
7. Playwright e2e with the virtual WebAuthn authenticator (section 12).
Rules: no placeholder or "coming soon" UI, every on-chain action links to stellar.expert, loading, empty and error states everywhere, mobile first. Commit after every green screen and update docs/PROGRESS.md.
```

---

## Prompt D: integration (Sunday 18:00, in the main repo)

```
Merge track/chain, track/intel and track/product into main, resolving conflicts in favour of docs/PLAN.md. Point the web app and API at the testnet deployment through GET /config. Run the full path from the UI with real passkeys: importer creates a deal and signs the promise, AI report, ops lists, two investors invest, the agent pays the deposit, the importer uploads the B/L, the agent confirms shipment, then on the seeded late deal the importer signs, repays after the 120-second tenor, pays the late fee, the agent sweeps it to charity, investors claim, the charity ledger shows the fee. Fix whatever breaks. Then run pnpm doctor. Report what works and what is behind a flag.
```

---

## Prompt E: fresh-eyes review (Monday 01:00, a new session)

```
You have not seen this code before. Review contracts/qafila_deals and services/api/src/pipeline against docs/PLAN.md sections 3.3.5, 5.5, 5.6 and 11. Look for: broken invariants, missing auth checks, unchecked arithmetic, unbounded loops, missing TTL extensions, decisions the LLM can make alone, prompt-injection paths, secrets in code. Write findings to docs/REVIEW.md ranked by severity, then fix the high ones with tests.
```

---

## Prompt F: submission (Monday 09:00)

```
Using docs/PLAN.md section 16, write the final README.md (with real links, contract ids, eval table and adoption numbers from /stats), docs/DEMO.md, and the submission answers. Check every link. Do not invent numbers: read them from the API, the eval output and deployments/testnet.json.
```

---

## Prompt M: mainnet scripts (after submission, only if Ilyes decides to run the micro-deal)

```
Prepare scripts/mainnet/*.ts for docs/PLAN.md section 13.3. Every script runs in dry-run by default and prints the exact transaction it would submit. Do not sign or submit anything. Ilyes runs them himself. If he asks you to help during a step, stop before any signing and wait for the exact phrase in section 13.3.
```

---

## Status check (any time)

```
Read docs/PROGRESS.md and docs/SPIKES.md. In five lines: what is green, what is red, what is behind a flag, what is next, and whether we are on time against section 14.1.
```
