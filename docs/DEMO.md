# Demo runbook

Testnet only, test dollars everywhere. Rehearse twice before recording. Keep a full backup screen recording of a clean run.

## Before the demo (10 minutes)

1. `pnpm run doctor` from the repo root: expect 24 ok, 0 fail. Fix any key balance it flags (friendbot accounts merged into the key, see `docs/PROGRESS-chain.md`).
2. `curl https://api.qafila.dev/health`: `ok: true`, indexer lag under 30 s, adapters `live` except what is deliberately mocked.
3. `pnpm demo-reset`: lists fresh copies of the three demo deals on the same contract (never redeploys, so venue wallets and positions survive). Then adopt them into the API with `POST /ops/deals/import-onchain` from the ops console or `curl` with the ops token (`/opt/qafila/ops-token` on the server) for the new on-chain ids the script prints.
4. Open https://qafila.dev on the demo laptop and https://qafila.dev/join?screen=1 on the venue screen.
5. Sign in: https://qafila.dev/onboarding?mode=signin with `i.jeridi20013@pi.tn`; the 6-digit code arrives by email through Resend. That profile holds the importer, ops and Sharia roles, owns the seeded demo deals, and is linked to the demo importer wallet `GB67IU…EXAKN` (Freighter, secret `DEMO_IMPORTER_SECRET` in `.env`) for the on-chain signatures.
6. Feature flags as intended (`GET /config`): off for anything not green.

## Video script (2 minutes 45 seconds, PLAN 16.2)

| Time | Show | Say |
|---|---|---|
| 0:00 | Landing: caravan line, live stats | Banks turn down up to 47% of small importers; many also avoid interest |
| 0:15 | Importer workspace: upload packet 04 (bad container check digit), run screening, rejected in under a minute with the failing check and evidence; then packet 01 approved with the risk score | Three documents and live registry, sanctions and carrier data checked in under a minute. The model never decides alone |
| 0:40 | Phone: scan the QR on /join, passkey wallet, 50 test dollars, invest 10 in the venue deal, name appears on the live counter | No seed phrase, no XLM, under 30 seconds |
| 1:05 | Shipping deal: importer uploads the bill of lading; agent log shows the loading event match and the on-chain confirmation; supplier payments on the deal page | The pool owns the goods before it sells them |
| 1:30 | Late deal: importer signs the sale (deposit counted as the first payment), repays after the 120-second tenor, pays the late fee; charity ledger shows it | The deposit counts as the importer's first payment; profit from trade, not time; late fees go to charity |
| 1:55 | stellar.expert: the share asset's flags, issuer master weight 0; the "If things go wrong" box | Sharia rules enforced by the protocol itself |
| 2:15 | Terminal: `examples/lender-agent` pays 0.50 USDC over x402 and verifies the signature on-chain | Other lenders and agents can buy our checks |
| 2:30 | Live counter, roadmap slide | Real users this weekend; next: Sharia board, first corridor, licence |

## Scene details

**AI screening (0:15).** Importer account: the signed-in demo profile above. New deal, supplier "Shenzhen Lanwan Electronics Co., Ltd.", goods "phone accessories", Shenzhen to Lagos. Upload `data/packets/04/*` first (rejected: container check digit), then replace with `data/packets/01/*` (approved). Cost 14,700. Screening takes about 60 seconds live; keep talking. The report shows evidence quotes per field and the registry line marked "fixture (mock)" for the fictional supplier; for a real registry hit, use the Huawei code `914403001922038216` in the verifier demo.

**Join (0:40).** Phone on the venue hotspot. Scan, tap "Create my wallet", Face ID, "Finish sign-up" (approves the investor on-chain and sends 50 test dollars), invest 10 in the venue deal, confirm with the passkey. Progress updates within 10 seconds on the deal page.

**Shipment (1:05).** The shipping deal is in `DepositPaid`. Upload `data/packets/03/bill_of_lading.pdf` with carrier and container from the packet; the agent confirms within a minute (ShipsGo returns a labelled fixture for demo containers). If the agent has not confirmed, ops presses "Check now" in the agent panel.

**Late deal (1:30).** The late deal is `Owned` with a 120-second tenor. The demo importer wallet (Freighter, `qafila-demo-importer`) signs the sale, waits past the due date, repays the rest, the late-fee card appears, pays it, the agent sweeps to charity (or ops presses sweep). The charity ledger lists the fee with its transaction.

**Protocol proof (1:55).** stellar.expert asset page of the deal's `QF…` asset: flags and the issuer's signers (master weight 0). Try "send" from a holder in the Stellar Lab to show the transfer fails (optional).

**x402 (2:15).** `pnpm --filter @qafila/lender-agent start` with USDC on the lender agent account. It prints the 402 challenge, pays, receives the job id, polls, verifies the signature locally and through `verify_attestation`.

## If something breaks

- Screening slow: Bedrock latency; the report arrives, keep narrating. Backup: the eval table in the README.
- Carrier has no data: the report says "fixture (mock)"; say so.
- Relayer refuses: `pnpm run doctor` shows the relayer balance; top up with friendbot merges.
- Anything else: play the backup recording.
