<<<<<<< HEAD
'use client';
import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';
=======
import type { Metadata } from 'next';
import { VerifierPage } from './verifier';

export const metadata: Metadata = { title: 'Verifier key' };
>>>>>>> track/product

export default function Page() {
  return <VerifierPage />;
}
