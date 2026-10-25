<<<<<<< HEAD
'use client';
import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';
=======
import type { Metadata } from 'next';
import { DealScreen } from '@/components/deal/deal-screen';
>>>>>>> track/product

export const metadata: Metadata = { title: 'Deal' };

/** Public deal page (PLAN 9.2): works logged out. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealScreen id={id} />;
}
