import type { Metadata } from 'next';
import { OpsQueue } from './queue';

export const metadata: Metadata = { title: 'Ops queue' };

export default function Page() {
  return <OpsQueue />;
}
