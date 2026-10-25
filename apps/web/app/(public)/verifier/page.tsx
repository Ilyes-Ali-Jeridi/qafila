import type { Metadata } from 'next';
import { VerifierPage } from './verifier';

export const metadata: Metadata = { title: 'Verifier key' };

export default function Page() {
  return <VerifierPage />;
}
