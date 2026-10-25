import type { Metadata } from 'next';
import { PortfolioScreen } from './portfolio';

export const metadata: Metadata = { title: 'Portfolio' };

export default function Page() {
  return <PortfolioScreen />;
}
