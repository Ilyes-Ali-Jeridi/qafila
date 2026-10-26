export const HEADLINE = 'Fund real shipments. Earn a fixed profit from trade, not interest.';

export const STEPS: Array<{ n: string; title: string; body: string; accent: string }> = [
  { n: '01', title: 'Verify', body: 'The importer uploads the invoice, packing list and supplier licence. AI checks them against each other, the company register, sanctions lists and live carrier data. A person signs off.', accent: 'text-indigo' },
  { n: '02', title: 'Fund', body: 'The importer locks a security deposit first. Investors fund the shipment and receive locked shares.', accent: 'text-teal' },
  { n: '03', title: 'Ship', body: 'The contract pays the supplier. The bill of lading is made out to Qafila. An agent confirms the loading event from carrier tracking and the balance is paid.', accent: 'text-saffron' },
  { n: '04', title: 'Repay', body: 'The importer buys the goods at a price fixed from day one and repays by the due date. Investors claim principal plus profit. Late fees go to charity.', accent: 'text-success' },
];

export const SHARIA: string[] = [
  'The deal owns real goods before it sells them.',
  'Profit comes from a sale at a price fixed at the start, and nothing grows with time.',
  'The importer puts money in first and loses it first if they let investors down.',
  'Late fees go to charity, never to investors or to Qafila.',
  'Shares cannot be sold on, so a debt is never traded at a discount.',
];

export const FAQ: [string, string][] = [
  ['Is this a loan?', 'No. The deal buys goods and resells them at a fixed price. Nobody is charged for time.'],
  ['Can I lose money?', 'Yes. If the importer does not pay and nothing is recovered, losses are shared by all holders, after the importer’s own money. Qafila loses alongside you on its 5% stake.'],
  ['Do I need a crypto wallet?', 'No. Your wallet is a passkey on your phone. No seed phrase, no XLM.'],
  ['Is this real money?', 'Not during the hackathon. Everything runs on Stellar testnet with test dollars.'],
];
