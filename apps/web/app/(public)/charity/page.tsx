import type { Metadata } from 'next';
import { CharityLedger } from './ledger';

export const metadata: Metadata = { title: 'Charity ledger' };

export default function Page() {
  return <CharityLedger />;
}
