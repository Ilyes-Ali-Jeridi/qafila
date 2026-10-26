import type { Metadata } from 'next';
import { DemoPage } from './demo';

export const metadata: Metadata = { title: 'Demo tour' };

export default function Page() {
  return <DemoPage />;
}
