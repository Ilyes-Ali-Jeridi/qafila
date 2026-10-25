import type { Metadata } from 'next';
import { OpsHealth } from './health';

export const metadata: Metadata = { title: 'System health' };

export default function Page() {
  return <OpsHealth />;
}
