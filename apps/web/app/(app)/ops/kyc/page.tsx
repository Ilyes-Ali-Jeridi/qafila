import type { Metadata } from 'next';
import { OpsKyc } from './kyc';

export const metadata: Metadata = { title: 'KYC approvals' };

export default function Page() {
  return <OpsKyc />;
}
