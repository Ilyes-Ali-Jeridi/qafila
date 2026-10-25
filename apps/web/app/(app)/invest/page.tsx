import type { Metadata } from 'next';
import { Marketplace } from './marketplace';

export const metadata: Metadata = { title: 'Deals' };

export default function Page() {
  return <Marketplace />;
}
