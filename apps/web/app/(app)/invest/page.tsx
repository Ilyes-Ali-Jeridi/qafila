<<<<<<< HEAD
'use client';
import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';
=======
import type { Metadata } from 'next';
import { Marketplace } from './marketplace';

export const metadata: Metadata = { title: 'Deals' };
>>>>>>> track/product

export default function Page() {
  return <Marketplace />;
}
