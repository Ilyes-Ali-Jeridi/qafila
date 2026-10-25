import type { Metadata } from 'next';
import { OpsAgent } from './agent';

export const metadata: Metadata = { title: 'Agent log' };

export default function Page() {
  return <OpsAgent />;
}
