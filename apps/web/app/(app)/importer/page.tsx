import type { Metadata } from 'next';
import { ImporterDashboard } from './dashboard';

export const metadata: Metadata = { title: 'Importer' };

export default function Page() {
  return <ImporterDashboard />;
}
