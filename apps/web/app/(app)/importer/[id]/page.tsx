<<<<<<< HEAD
'use client';
import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';
=======
import type { Metadata } from 'next';
import { ImporterDealScreen } from './deal';
>>>>>>> track/product

export const metadata: Metadata = { title: 'My deal' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImporterDealScreen id={id} />;
}
