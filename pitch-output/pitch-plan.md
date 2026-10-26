# Qafila pitch video, version 4 (2 minutes 29 seconds)

Rendered file: `pitch-output/pitch.mp4` (1920x1080, 30 fps, 149 s). Composition: `pitch-output/composition/` (Hyperframes, one `index.html`). Narration script: `pitch-output/narration.md`. Voice: Amazon Polly, generative voice Matthew at 93% rate with a short breath after each sentence, one mp3 per section in `composition/assets/voice/`.

Version 4 follows the mentors' advice: the jury skims, so the order is the problem, the product in plain words, how Qafila earns, how it works for each person, what it is built with, the numbers, why Stellar. Nothing assumes the viewer knows Islamic finance or Stellar. Version 1 (3 min 27 s, statistics first, faster) is at commit 895962d and version 2 (2 min 42 s, screenshots) at e4ef167 in git history.

## Scenes

| # | Time | Scene | On screen |
|---|------|-------|-----------|
| 1 | 0:00 to 0:29 | The problem | 37% of small importers turned down; the 92 billion dollar gap; three reasons (same cost to check any size, 5 billion dollars of document fraud, interest refused); 205 billion dollars on-chain to Sub-Saharan Africa, 43% stablecoins; "The money is there. The trust is not." |
| 2 | 0:29 to 0:51 | The product | Wordmark with two real marketplace deal cards; then three steps (the contract buys and owns the goods, sells them to the importer at a fixed price, investors share the fixed profit); "No interest. Nothing grows with time."; murabaha in one line |
| 3 | 0:51 to 1:05 | How Qafila earns | The deal's real terms card (cost, markup, platform fee out of the markup earned only on repayment, investors' share, sale price, deposit, late fee) with the 8% markup split into 6% investors and 2% Qafila; Qafila co-invests 5% of every deal |
| 4 | 1:05 to 1:23 | The importer | Passkey onboarding (the name types itself), the ops checks-and-evidence list ticking in as the narrator names each check, the approved badge, the on-chain timeline with the signed promise and the locked deposit |
| 5 | 1:23 to 1:35 | The investor | The join poster with the real QR and live counters, the AI verification card as investors see it, the invest panel, the investment landing and the share token card |
| 6 | 1:35 to 1:50 | Shipment and repayment | Progress rail over carrier tracking and the on-chain timeline, the sale step with the portfolio stats, the charity receipt |
| 7 | 1:50 to 2:03 | Built on Stellar | Five cards: Soroban contract in Rust, OpenZeppelin smart accounts (passkey wallets, the agent), our fee-sponsoring relayer, signed AI reports verifiable on-chain, paid verification over x402 through the OpenZeppelin facilitator |
| 8 | 2:03 to 2:16 | The numbers | "Built for HackMeridian. Live on testnet." with six tiles: 49 contract tests, 12/12 AI packets, 9/9 lifecycle scenarios, 158 TypeScript tests, 0.50 USDC paid over x402, under 10 s to a passkey wallet; the contract id |
| 9 | 2:16 to 2:29 | Why Stellar, outro | "A forgotten market. $90bn a year." with cheap settlement, stablecoins, wallets anyone can use; wordmark, HackMeridian 2026, "Visit qafila.dev", the promise line |

## Sources for the numbers (checked 26 Oct 2026)

- 37% of SME trade finance applications rejected, 63% approved; gap of 74 to 92 billion dollars (2024 data): African Development Bank, "Trade Finance in Africa" 2025 edition, as reported by Global Trade Review and the AfDB SME brief. The narration rounds the gap to "up to 92 billion" and "90 billion a year".
- 205 billion dollars received on-chain by Sub-Saharan Africa between July 2024 and June 2025, up 52%, stablecoins about 43% of the flow: Chainalysis, 2025 Geography of Cryptocurrency report. The narration says "half of it in stablecoins"; the card shows 43%.
- About 5 billion dollars a year lost to trade finance document fraud: ICC estimate (modelled), via Global Trade Review.
- The numbers slide: 49 contract tests (`cargo test`), 12 of 12 AI packets (`pnpm eval`, live), 9 of 9 lifecycle scenarios (`e2e-chain`), 158 TypeScript tests (shared 11, chain 32, api 115), 0.50 USDC per x402 verification, passkey wallet in under 10 seconds (SP5). The business model numbers are the real terms of demo deal 1: 8% markup, 2% platform fee out of it, 6% to investors, 5% co-investment.

## App views

The app views in scenes 2 to 5 are the app's own components rebuilt inside the composition, not screenshots: same tokens (`apps/web/app/globals.css`), same markup and copy (`components/deal/deal-card`, `checks-list`, `onchain-timeline`, `if-things-go-wrong`, `invest-panel`, `tracking-events`, the onboarding wallet step, the join poster, the charity ledger), and the demo dataset's real numbers and hashes. Rebuilding them lets each row, badge and bar animate in step with the narration and stay sharp at 1080p. The join QR is the real `qafila.dev/join` code (`assets/ui/qr-join.svg`). The earlier screenshots stay in `assets/shots/` for reference.

## Audio

- Narration at full volume, one segment per scene, 0.4 s of air between segments and a 1 s pause after "The trust is not."
- Music bed `assets/music/bed.mp3` (the brag track looped with a 4 s crossfade, fade-out from 145.5 s) at volume 0.15 under the voice. The final file is loudness-normalised to -16 LUFS.
- Sparse effects: a soft impact when the name lands, drops on the first screening callout and the first and last tech cards, a bell on the approved callout, a bong on the final wordmark.
