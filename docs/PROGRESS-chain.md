# Progress log, Track A (chain)

Times are WET (Lisbon). H0 = Sun 25 Oct 2026 09:00. Integrator merges this into docs/PROGRESS.md.

## Sun 25 Oct

- 15:05 (H6) Track A session start in `.worktrees/chain` (branch `track/chain`). Read CLAUDE.md, PLAN.md, FLOWS.md, KICKOFF_PROMPTS.md, PROGRESS.md, the stub contract.
- 15:20 (H6) Handoff 1 done: 11 testnet keys generated and friendbot-funded (admin, verifier, agent signer, share funder, faucet, coinvest, qUSD issuer, charity, treasury, demo importer, relayer); secrets appended to `.env` under the `.env.example` names. qUSD issued (issuer without auth flags), SAC `CB7WLKU45NHMLECCZGP5H6RH5IHMSHJXA7U4JSNM4MQT7WT46LZMC3KZ`, 10M qUSD minted to the faucet, 1M to coinvest, 200k to the demo importer, 100k to admin; trustlines for charity and treasury. Probe contract deployed: `CD7JYELMF6W5LLWINWJ7XO6BYAMDFBYLJ4VTMTOZ3LWCFH2MZ7MQWXZP`. Written to `.shared/probe.json` and `.shared/accounts.json`, and `docs/SPIKES-chain.md`.
  - Found: the stellar CLI reads `.env` from the cwd and then requires `STELLAR_NETWORK_PASSPHRASE`; added it to `.env.example`.
- 15:52 (H7) SP1, SP2, SP3, SP4 all PASS on testnet with a locked issuer (`contracts/spikes/sac_admin`, details and tx hashes in docs/SPIKES-chain.md). No fallback needed: the contract remains SAC admin after the issuer is locked, deauthorized C and G balances cannot transfer, clawback works on deauthorized balances, and SAC `trust` gives a G investor the share trustline. Forked two helpers: one builds `packages/chain` (`@qafila/chain`) and the factory script, one runs SP6 (smart-account-kit) and SP12 (getEvents).
