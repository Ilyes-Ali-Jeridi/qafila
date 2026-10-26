# Qafila pitch narration, version 2 (about 2 minutes 30 seconds)

Written for a jury that may know nothing about Islamic finance or Stellar. Order: the problem, the product in plain words, how it works for each person, what it is built with, why Stellar. Slower pace than version 1. Numbers verified on 26 Oct 2026: AfDB trade finance report (2025 edition), Chainalysis 2025 Geography of Cryptocurrency, ICC fraud estimate.

## 1. The problem
Across Africa, small importers ask banks for trade finance, and more than a third are turned down. That is a gap of up to 92 billion dollars a year. Checking a small shipment costs a bank as much as checking a big one. Forged documents cost the industry about 5 billion dollars a year. And many Muslim business owners refuse loans with interest. Yet Sub-Saharan Africa received 205 billion dollars on-chain last year, half of it in stablecoins. The money is there. The trust is not.

## 2. The product
Qafila is a marketplace on Stellar where anyone can fund a real shipment for an importer that banks turn down. A smart contract buys the goods from the supplier, owns them, and sells them to the importer at a price fixed on day one. The investors who paid for the goods share that fixed profit. No interest, nothing grows with time. This is murabaha, the oldest form of Islamic trade finance, on a public blockchain where every step can be checked.

## 3. The importer
The importer signs up with a passkey: her face or fingerprint, no seed phrase. She uploads three documents: the invoice, the packing list and her supplier's licence. Qafila's AI reads them and checks them against each other, the company register, sanctions lists and live ship tracking. A person approves. She signs a plain-language promise to buy and locks a 20 percent deposit.

## 4. The investor
The investor scans a QR code, creates a wallet in thirty seconds and picks a shipment. Before paying, they see the report and who loses first if things go wrong: the importer's deposit, then recoveries, then investors. They fund the deal and receive shares, tokens on Stellar, locked until the deal ends.

## 5. Shipment and repayment
The contract pays the supplier and the goods ship. An autonomous agent checks the bill of lading and confirms the shipment on-chain. The importer pays the fixed price, and investors claim their money plus the profit. A late fee goes to charity, on a public ledger, never to investors.

## 6. Built with
Under the hood: a Soroban contract in Rust with forty-nine tests. OpenZeppelin smart accounts for the passkey wallets and for the shipment agent, with our own relayer paying the fees. Every AI report is signed, so other contracts can verify it. And a paid verification API that other lenders' agents buy over x402, through the OpenZeppelin facilitator.

## 7. Why Stellar
Trade finance in Africa is a forgotten market, 90 billion dollars a year, and Stellar is built for it: cheap settlement, stablecoins, and wallets anyone can use. Qafila was built in one weekend at HackMeridian 2026 and runs on testnet today. Qafila dot dev. Fund a real shipment, own the goods, share a fixed profit.
