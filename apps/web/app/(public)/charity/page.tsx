<<<<<<< HEAD
'use client';
import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';
=======
import type { Metadata } from 'next';
import { CharityLedger } from './ledger';

export const metadata: Metadata = { title: 'Charity ledger' };
>>>>>>> track/product

export default function Page() {
  return <CharityLedger />;
}
