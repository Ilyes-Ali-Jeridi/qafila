# Qafila pitch video (about 3 minutes, 30 s)

Rendered file: `pitch-output/pitch.mp4` (1920x1080, 30 fps, 207.5 s). Composition: `pitch-output/composition/` (Hyperframes, one `index.html`). Narration script: `pitch-output/narration.md`. Voice: Amazon Polly, generative voice Matthew, one mp3 per section in `composition/assets/voice/`.

## Scenes

| # | Time | Scene | On screen |
|---|------|-------|-----------|
| 1 | 0:00 to 0:26 | The numbers | Stat cards: 37% of SME trade finance requests rejected, only 63% approved; the 74 to 92 billion dollar gap; "The money is there."; 205 billion dollars received on-chain by Sub-Saharan Africa, 43% in stablecoins |
| 2 | 0:25 to 0:54 | Why banks say no | Four cards: due diligence costs the same at any size; about 5 billion dollars a year of document fraud; interest is off limits for many owners; the last co-ownership platforms collapsed |
| 3 | 0:54 to 1:21 | Qafila | Wordmark, "A caravan on Stellar.", the landing page; then the four-step flow (investors fund, the contract buys and owns, the importer buys at a fixed price, fixed profit shared) and the charity rule |
| 4 | 1:20 to 2:03 | The importer | Six steps lighting up beside real screens: passkey onboarding, the checks-and-evidence report (ops console), the deal page with the signed promise and the locked deposit |
| 5 | 2:02 to 2:30 | The investor | The join poster with the QR code, the deal page (1 share per test dollar), the "before you decide" panel with the loss order |
| 6 | 2:29 to 3:00 | Shipment and repayment | Progress rail (funded, supplier deposit, shipped, B/L matched, agent signs, balance paid, sale signed, repaid) over the payments and carrier tracking screen, the sale signing, the charity ledger and the portfolio |
| 7 | 3:00 to 3:27 | Live today | Checklist of what runs on testnet beside the verifier key page; outro with the wordmark, qafila.dev and the promise line |

## Sources for the numbers (checked 26 Oct 2026)

- 37% of SME trade finance applications rejected, 63% approved; gap of 74 to 92 billion dollars (2024 data): African Development Bank, "Trade Finance in Africa" 2025 edition, as reported by Global Trade Review and the AfDB SME brief.
- 205 billion dollars received on-chain by Sub-Saharan Africa between July 2024 and June 2025, up 52%, stablecoins about 43% of the flow: Chainalysis, 2025 Geography of Cryptocurrency report (Sub-Saharan Africa chapter).
- About 5 billion dollars a year lost to trade finance document fraud: ICC estimate (modelled), via Global Trade Review.

## Screens used

All screenshots are in `composition/assets/shots/`. Public pages (landing, marketplace, join, verifier) were captured on qafila.dev. Signed-in pages (onboarding, importer deals, ops console, portfolio, charity ledger) were captured on the local mock stack with the demo importer session, with the same data shapes as production and the testnet pill visible.

## Audio

- Narration at full volume, one segment per scene, 0.6 to 0.8 s of air between segments.
- Music bed `assets/music/bed.mp3` (the brag track looped with a 4 s crossfade, fade-out from 204 s) at volume 0.15 under the voice.
- Sparse effects: a soft impact when the name lands, drops on the first and last check in the importer and live scenes, a bell on the approved chip, a bong on the final wordmark.
