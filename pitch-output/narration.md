# Qafila pitch narration, version 4 (2 minutes 30 seconds)

Written for a jury that may know nothing about Islamic finance or Stellar. Order: the problem, the product in plain words, how Qafila earns, how it works for each person, what it is built with, the numbers, why Stellar. Numbers verified on 26 Oct 2026: AfDB trade finance report (2025 edition), Chainalysis 2025 Geography of Cryptocurrency, ICC fraud estimate; test counts from the repository (cargo 49, vitest 11 + 32 + 115, eval 12 packets, e2e-chain 9 scenarios).

## 1. The problem
Across Africa, small importers ask banks for trade finance, and more than a third are turned down: a gap of up to 92 billion dollars a year. Small deals cost as much to check as big ones. Forged documents cost about 5 billion dollars a year. And many Muslim business owners refuse loans with interest. Yet Sub-Saharan Africa received 205 billion dollars on-chain last year, half of it in stablecoins. The money is there. The trust is not.

## 2. The product
Qafila is a marketplace on Stellar where anyone can fund a real shipment for an importer that banks turn down. A smart contract buys the goods from the supplier, owns them, and sells them to the importer at a price fixed on day one. The investors who paid for the goods share that fixed profit. No interest, nothing grows with time. This is murabaha, the oldest form of Islamic trade finance.

## 3. How Qafila earns
How does Qafila earn? A fee out of that markup, paid only when the importer repays. On this deal: 8 percent markup, 6 to investors, 2 to Qafila. And Qafila co-invests 5 percent of every deal.

## 4. The importer
The importer signs up with a passkey and uploads three documents: the invoice, the packing list and her supplier's licence. Qafila's AI checks them against each other, the company register, sanctions lists and live ship tracking. A person approves. She signs a plain-language promise to buy and locks a 20 percent deposit.

## 5. The investor
The investor scans a QR code, creates a wallet in thirty seconds, picks a shipment, reads the AI report, and funds the deal. Their shares are tokens on Stellar, locked until the deal ends.

## 6. Shipment and repayment
The contract pays the supplier and the goods ship. An autonomous agent checks the bill of lading and confirms the shipment on-chain. The importer pays the fixed price, investors claim their money plus the profit, and any late fee goes to charity, on a public ledger.

## 7. Built with
Under the hood: a Soroban contract in Rust, OpenZeppelin smart accounts for the passkey wallets and the shipment agent, our own relayer paying the fees, and signed AI reports sold to other lenders over x402.

## 8. Live on testnet
All of it is live on Stellar testnet: forty-nine contract tests, twelve of twelve AI packets judged right, nine of nine lifecycle scenarios, a hundred and fifty-eight TypeScript tests, and a passkey wallet in under ten seconds.

## 9. Why Stellar
Trade finance in Africa is a forgotten market, 90 billion dollars a year, and Stellar is built for it. Visit qafila dot dev: fund a real shipment, own the goods, share a fixed profit.
