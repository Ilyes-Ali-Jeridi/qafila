# Qafila pitch video, version 2 (2 minutes 42 seconds)

Rendered file: `pitch-output/pitch.mp4` (1920x1080, 30 fps, 162.5 s). Composition: `pitch-output/composition/` (Hyperframes, one `index.html`). Narration script: `pitch-output/narration.md`. Voice: Amazon Polly, generative voice Matthew at 90% rate with a short breath after each sentence, one mp3 per section in `composition/assets/voice/`.

Version 2 follows the mentors' advice: the jury skims, so the order is the problem, the product in plain words, how it works for each person, what it is built with, why Stellar. Nothing assumes the viewer knows Islamic finance or Stellar. Version 1 (3 min 27 s, statistics first, faster) is in git history at commit 895962d.

## Scenes

| # | Time | Scene | On screen |
|---|------|-------|-----------|
| 1 | 0:00 to 0:32 | The problem | 37% of small importers turned down; the 92 billion dollar gap; three reasons (same cost to check any size, 5 billion dollars of document fraud, interest refused); 205 billion dollars on-chain to Sub-Saharan Africa, 43% stablecoins; "The money is there. The trust is not." |
| 2 | 0:32 to 0:58 | The product | Wordmark with the landing page; then three steps (the contract buys and owns the goods, sells them to the importer at a fixed price, investors share the fixed profit); "No interest. Nothing grows with time."; murabaha explained in one line |
| 3 | 0:58 to 1:21 | The importer | Five steps beside real screens: passkey onboarding, the checks-and-evidence report with callouts (documents cross-checked, company register, sanctions, ship tracking, a person approves), the deal page with the signed promise and the locked deposit |
| 4 | 1:21 to 1:40 | The investor | QR join poster, the "before you decide" panel with the loss order, the deal page with the shares callout |
| 5 | 1:40 to 1:57 | Shipment and repayment | Progress rail (supplier paid, goods ship, B/L checked, agent confirms, importer pays, investors paid, late fee to charity) over the payments and carrier tracking screen, the sale signing, the charity ledger |
| 6 | 1:57 to 2:19 | Built on Stellar | Five cards: Soroban contract in Rust (49 tests), OpenZeppelin smart accounts (passkey wallets, the agent), our fee-sponsoring relayer, signed AI reports verifiable on-chain, paid verification over x402 through the OpenZeppelin facilitator |
| 7 | 2:19 to 2:42 | Why Stellar, outro | "A forgotten market. $90bn a year." with cheap settlement, stablecoins, wallets anyone can use; wordmark, HackMeridian 2026, qafila.dev, the promise line |

## Sources for the numbers (checked 26 Oct 2026)

- 37% of SME trade finance applications rejected, 63% approved; gap of 74 to 92 billion dollars (2024 data): African Development Bank, "Trade Finance in Africa" 2025 edition, as reported by Global Trade Review and the AfDB SME brief. The narration rounds the gap to "up to 92 billion" and "90 billion a year".
- 205 billion dollars received on-chain by Sub-Saharan Africa between July 2024 and June 2025, up 52%, stablecoins about 43% of the flow: Chainalysis, 2025 Geography of Cryptocurrency report. The narration says "half of it in stablecoins"; the card shows 43%.
- About 5 billion dollars a year lost to trade finance document fraud: ICC estimate (modelled), via Global Trade Review.

## Screens used

All screenshots are in `composition/assets/shots/`. Public pages (landing, join) were captured on qafila.dev. Signed-in pages (onboarding, importer deals, ops console checks, invest pages, charity ledger) were captured on the local mock stack with the demo importer session, with the same data shapes as production and the testnet pill visible.

## Audio

- Narration at full volume, one segment per scene, 0.7 to 0.9 s of air between segments and a 2.3 s pause after "The trust is not."
- Music bed `assets/music/bed.mp3` (the brag track looped with a 4 s crossfade, fade-out from 159 s) at volume 0.15 under the voice. The final file is loudness-normalised to -16 LUFS.
- Sparse effects: a soft impact when the name lands, drops on the first screening callout and the first and last tech cards, a bell on the approved callout, a bong on the final wordmark.
