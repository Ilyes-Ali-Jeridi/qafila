# Submission answers (HackMeridian 2026 form)

Short, plain words. Paste as is; replace the two links marked [upload].

## Project title
Qafila

## Tagline
Fund real shipments for importers that banks turn down. Earn a fixed profit from trade, not interest.

## Description
Qafila is a halal trade-finance marketplace on Stellar.

Small importers in Africa cannot get credit: their orders are too small for banks to check, trade documents are easy to forge, and many owners refuse loans with interest.

How Qafila works, in four steps:
1. **Verify.** The importer uploads the invoice, the packing list and the supplier's licence. AI checks them against each other, the company register, sanctions lists and live ship tracking. A person signs off.
2. **Fund.** The importer locks a 20% deposit first. Investors fund the shipment and receive locked share tokens.
3. **Ship.** A Soroban contract pays the supplier and owns the goods. An agent confirms the loading event from carrier data and pays the balance.
4. **Repay.** The importer buys the goods at a price fixed on day one. Investors claim their money plus the fixed profit. Late fees go to charity, never to investors.

This is murabaha, the oldest form of Islamic trade finance, enforced by the contract: the deal owns real goods, the price never grows with time, the importer loses first.

What is live on Stellar testnet: passkey wallets in under 20 seconds with fees paid by our relayer; one locked share asset per deal; the contract with promise, funding, supplier payments, shipment confirmation, sale, repayment, late fees, claims and defaults (49 tests); the AI screening (12 of 12 test packets judged right); a paid verification API other lenders' agents can buy over x402 with USDC; a map with carrier tracking; a public charity ledger. Every on-chain action links to stellar.expert.

Links: https://qafila.dev (app) · https://qafila.dev/demo (judges' tour) · https://api.qafila.dev (API) · contract https://stellar.expert/explorer/testnet/contract/CAJW4MIEZXIUFHGLQISXLDF3XIHJOLGSKGDQQHBIQJ2BJU34ZT3COSPV

## Problem solved
Who: small importers in Africa, like a shop owner in Lagos buying phone accessories from a factory in Shenzhen. More than a third of them are turned down by banks, a gap of up to $92 billion a year (AfDB 2025). Many also refuse interest.

How Qafila helps: investors anywhere fund her shipment. The contract buys the goods and sells them to her at a fixed price, so she gets goods on credit without interest, investors get a fixed real-economy return, and every step is checked by AI and visible on-chain.

## Challenges
- Making the Sharia rules real in code, not in a PDF: the contract owns the goods before it sells them, the price is fixed, the importer loses first, late fees can only go to charity. We wrote property tests for each rule.
- Share tokens that cannot be traded: a classic asset per deal whose issuer is controlled by the contract (master key weight 0) and whose holders are authorized only by the contract.
- Wallets for people who never used crypto: passkey smart accounts with fees paid by our relayer, so a wallet takes 20 seconds and no XLM.
- AI that reads real trade documents (Chinese and English) without deciding alone: deterministic checks, a company register, sanctions lists and carrier tracking decide with a written policy; a person signs off.
- Doing it in 24 hours: one person directing Claude Code on parallel tracks with a plan, timeboxes and a progress log.

## What's next
- A Sharia board review of the contract and the terms.
- A first corridor, China to Nigeria, with a licensed partner, cargo and credit insurance, and real USDC.
- A mainnet micro deal under $500 with our own money right after the hackathon.
- Live carrier tracking with a verified ShipsGo key (the demo replays recorded carrier data).
- A Stellar Community Fund application.

## Repository link
https://github.com/Ilyes-Ali-Jeridi/qafila (make it public before sending)

## Project website link
https://qafila.dev (llms.txt, robots.txt and sitemap.xml are served)

## Demo video link
[upload] demo-output/demo.mp4 (3 minutes: problem, live demo, how, next; subtitles burned in; demo-output/demo.srt for YouTube captions). The 2 min 29 s pitch is pitch-output/pitch.mp4.

## Deck file
docs/deck.html (10 slides, opens in any browser; arrow keys to move; print to PDF if a PDF is needed)

## Thematic track
Stellar Composed (passkey smart accounts, OpenZeppelin accounts, x402 and USDC composed into one flow). Stellar Unlocked also fits: the locked per-deal share assets.

## Tech stack
rust, soroban, typescript, nextjs, react, hono, postgres, supabase, drizzle, aws bedrock, qwen, openzeppelin, passkeys, x402, usdc, maplibre, playwright, vitest, vercel, aws

## Prior work disclosure
None. The repository was created on Sunday 25 October 2026 at 12:50 WET and all code, design and copy were written during the event. Third-party assets: open-source fonts (Bricolage Grotesque, Figtree, JetBrains Mono), map tiles from OpenFreeMap, a music bed and sound effects from the Hyperframes asset packs, OpenZeppelin Stellar contracts and smart-account kit.

## AI tooling note
- Claude Code (Claude Fable 5.1) wrote most of the code, tests and docs under direction, on parallel tracks (contract, AI pipeline, web app) with a reviewer pass; it also fixed production bugs live.
- Raven MCP and the Stellar skills answered Stellar questions (SDK, SEPs, OpenZeppelin).
- Inside the product, Qwen on AWS Bedrock reads the trade documents; the decisions are made by deterministic checks and a written policy, never by the model alone.
- Amazon Polly made the narration voice; Hyperframes rendered the videos; the deck and the copy were drafted with Claude and edited by hand.
