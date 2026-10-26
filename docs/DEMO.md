# Demo runbook

Testnet only, test dollars everywhere. Rehearse twice before recording. Keep a full backup screen recording of a clean run.

## Before the demo (10 minutes)

1. `pnpm run doctor` from the repo root: expect 24 ok, 0 fail. Fix any key balance it flags (friendbot accounts merged into the key, see `docs/PROGRESS-chain.md`).
2. `curl https://api.qafila.dev/health`: `ok: true`, indexer lag under 30 s, adapters `live` except what is deliberately mocked.
3. `pnpm demo-reset`: lists fresh copies of the three demo deals on the same contract (never redeploys, so venue wallets and positions survive). Then adopt them into the API with `POST /ops/deals/import-onchain` from the ops console or `curl` with the ops token (`/opt/qafila/ops-token` on the server) for the new on-chain ids the script prints.
4. Open https://qafila.dev on the demo laptop and https://qafila.dev/join?screen=1 on the venue screen.
5. Sign in: https://qafila.dev/onboarding?mode=signin with `i.jeridi20013@pi.tn`; the 6-digit code arrives by email through Resend. That profile holds the importer, ops and Sharia roles, owns the seeded demo deals, and is linked to the demo importer wallet `GB67IU…EXAKN` (Freighter, secret `DEMO_IMPORTER_SECRET` in `.env`) for the on-chain signatures.
6. Feature flags as intended (`GET /config`): off for anything not green.

## Judges on their own: https://qafila.dev/demo

The tour page (FF_DEMO_MODE on) has three stories: fund a shipment with a passkey wallet on /join, enter the importer's desk, enter the ops console. The two "Enter as" views are read-only sessions of the demo profile narrowed to one role; the account menu signs out of them. Every deal is listed with its state in plain words and a link to its public page.

## State of production for filming (26 Oct, late morning)

| Deal | Where it stands | Use it for |
|---|---|---|
| 1, 4 | Listed, open for funding | the phone join and invest shot |
| 2 | DepositPaid, bill of lading uploaded, tracked: OOCL ZHUHAI, Ningbo to Lagos Apapa, 5 events (recorded carrier fixture) | the map with the vessel, the tracking events, the ops "Record the next event" button (demo mode). Its shipment check is in review (the deal says Mombasa, the B/L says Lagos), so the agent refuses to confirm: say so, it is the safety check working |
| 3 | Closed: shipped, sold, repaid after the due date, 50 test dollars late fee to charity, three holders claimed | "already shipped and claimed": payments list, on-chain timeline, /charity |
| 6, 7, 8 | Screened: rejected (container check digit), review (price 4x reference), approved | the ops queue and a review page with evidence |
| 9 | Approved, promise text generated; cannot be listed (another wallet holds the on-chain promise for these documents from an earlier run) | nothing; leave it |

Fresh packets for a live screening: 06 (bottled wine, halal reject), 09 (sanctions hit), 08 (registry status), 10 (B/L vessel mismatch). Packets 01 to 05 and 07 are already on deals or blocked by fingerprints.

`pnpm tsx scripts/demo-story.ts late <n>` runs the whole late path on an Owned deal; `hero` builds a new deal up to the shipment check; `sweep` sends what is owed to charity.

## Filming order, 90 second video

Record in this order; each shot leaves the state the next one needs. Sign in on the laptop as the demo profile first, Freighter unlocked with the demo importer wallet, phone on the hotspot.

| Time | Shot | Show |
|---|---|---|
| 0:00 | Landing | qafila.dev, the live counters |
| 0:10 | Ops queue | Deals 6, 7, 8 and their decisions. Open deal 6: the failing check and its evidence |
| 0:25 | Phone | Scan the QR on /join, passkey, 50 test dollars, invest 10 in deal 4. The counter moves on the laptop |
| 0:40 | Deal 2 public page | The map with the route and the vessel, the tracking events. Ops: "Record the next event: Arrived", the tracking updates |
| 0:60 | Deal 3 public page | Sold at the fixed price, repaid late, the late fee, the claims in the payments list. Open /charity for the receipt |
| 1:15 | Proof | stellar.expert contract page, then qafila.dev/demo as the closing frame |

## Live demo order for the judges

1. qafila.dev/demo: the three stories.
2. Screening live: importer workspace, new deal with packet 06. Start it first and come back to it; it returns rejected on the halal check in one to three minutes.
3. Importer approval: the pending registration at /ops/kyc, press Approve.
4. Phone: join and invest in deal 4.
5. Deal 2: the map, "Record the next event" (Arrived, then Discharged), the incident that explains why the agent did not confirm.
6. Deal 3: the closed deal, the charity ledger, the verifier page.

## If something breaks

- Screening slow: Bedrock latency; the report arrives, keep narrating. Backup: the eval table in the README.
- Carrier has no data: the report says "fixture (mock)"; say so.
- Relayer refuses: `pnpm run doctor` shows the relayer balance; top up with friendbot merges.
- Anything else: play the backup recording.
