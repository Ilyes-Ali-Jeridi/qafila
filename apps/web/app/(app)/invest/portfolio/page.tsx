<<<<<<< HEAD
'use client';
import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';
=======
import type { Metadata } from 'next';
import { PortfolioScreen } from './portfolio';

export const metadata: Metadata = { title: 'Portfolio' };
>>>>>>> track/product

export default function Page() {
  return <PortfolioScreen />;
}
