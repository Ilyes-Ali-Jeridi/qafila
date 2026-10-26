# Submission answers (draft for the HackMeridian form)

Edit before sending. Numbers in section 5 are read from https://api.qafila.dev/stats at submission time.

## 1. Project name and one line
**Qafila**: fund a real shipment for an African importer that banks turn down, earn a share of a fixed trade profit, and see every step on Stellar. AI checks that the goods, the ship and the supplier are real.

## 2. Problem
Small African importers are rejected by banks because verifying a $10,000 deal costs almost as much as a $1 million one; 30 to 47% of small-business trade finance applications are refused and the gap is above $81 billion. Many also avoid interest-based credit. Trade fraud (forged documents, the same invoice financed twice) makes lenders cautious, and the last wave of "own a share of a real asset" platforms in Africa collapsed because nobody could verify the asset and the operator held the money.

## 3. Solution
A trade-finance app designed for Sharia compliance, on Stellar. Investors fund a specific shipment; a Soroban contract buys the goods from the supplier, owns them, and sells them to the importer at a price fixed and disclosed from day one (murabaha). The importer locks a security deposit before anything ships and loses it first if the deal fails through their fault. An AI pipeline verifies the invoice, packing list, licence and bill of lading against each other, the GLEIF company register, OpenSanctions and live carrier tracking, with deterministic checks and a policy table deciding, never the model alone. Late fees go to charity, never to investors. Every report is signed and verifiable on-chain.

## 4. Stellar integration (what is live on testnet)
- **Unlocked.** One classic asset per deal with `AUTH_REQUIRED`, `AUTH_REVOCABLE` and `AUTH_CLAWBACK_ENABLED`; the issuer's SAC admin is the Qafila contract and its master key weight is 0, so only the contract can mint, authorize, freeze or claw back. Shares are deauthorized in the mint call (compliance-locked receipts that cannot be sold on) and clawed back at settlement. The contract probes every share token on listing. Spikes SP1 to SP4 recorded with transaction hashes.
- **Composed.** Passkey smart accounts (OpenZeppelin accounts via smart-account-kit) with fees sponsored by Qafila's own relayer, wallet in under 10 seconds; a restricted OpenZeppelin smart account for the shipment agent with a `CallContract(qafila_deals)` rule; x402 paid verification API settled through the OpenZeppelin facilitator with a lender-agent client; Reflector exchange rates; Trustless Work multi-release escrow mode (spiked on-chain, behind a flag on testnet); on-chain verification of signed AI reports (`verify_attestation`) for other contracts.
- Contract `CAJW4MIEZXIUFHGLQISXLDF3XIHJOLGSKGDQQHBIQJ2BJU34ZT3COSPV`, 49 contract tests including property tests over the Sharia invariants, 9 of 9 lifecycle scenarios on a local network, fresh-eyes security review.

## 5. Traction during the event
Wallets created, investors approved and joins at the venue: see https://qafila.dev (live counter) and https://api.qafila.dev/stats. [Refresh here before sending.]

## 6. What was built during the hackathon
Everything: the repository was created Sunday 25 October 2026 at 12:50 WET with the plan, code starts at 14:30 WET. Commit history and the timed build log (`docs/PROGRESS.md`) are in the repository.

## 7. Team
Ilyes Ali Jeridi, with Claude Code running three parallel engineering tracks (chain, intelligence, product), an integrator and a fresh-eyes reviewer.

## 8. Continuation
Sharia board review and fatwa, a pilot corridor (China to Nigeria) with a real importer, crowdfunding licence path (CMVM in Portugal, SEC in Nigeria), cargo and credit insurance, Stellar Community Fund application. A private mainnet micro-deal under $500 is planned after submission as proof for the finalist pitch.

## 9. Links
- App: https://qafila.dev · API: https://api.qafila.dev · Repository: https://github.com/Ilyes-Ali-Jeridi/qafila (private during the event; share with the judges' accounts or make public at submission)
- Contract: https://stellar.expert/explorer/testnet/contract/CAJW4MIEZXIUFHGLQISXLDF3XIHJOLGSKGDQQHBIQJ2BJU34ZT3COSPV
- Video: [link] (rendered file: `pitch-output/pitch.mp4`, 2 min 30 s, script in `pitch-output/narration.md`; the 23 s teaser is `brag-output/brag.mp4`)
- Deck: [link]
