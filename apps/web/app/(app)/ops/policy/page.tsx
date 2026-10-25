import type { Metadata } from 'next';
import { OpsPolicy } from './policy';

export const metadata: Metadata = { title: 'Halal policy' };

export default function Page() {
  return <OpsPolicy />;
}
