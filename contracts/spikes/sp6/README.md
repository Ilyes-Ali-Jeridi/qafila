SP6 spike. Results: ../results/sp6.md. Before running `agent-account.mts` in a fresh clone:
`ln -sfn ../../../node_modules/.pnpm/node_modules contracts/spikes/sp6/node_modules` (git-ignored; the ESM script needs @stellar/stellar-sdk, which pnpm does not hoist to the root).
`ping/` is a standalone crate (own `[workspace]`): build with `CARGO_TARGET_DIR=../../../target stellar contract build` from inside `ping/`.
