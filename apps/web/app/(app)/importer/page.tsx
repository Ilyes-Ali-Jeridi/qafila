<<<<<<< HEAD
'use client';
import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';
=======
import type { Metadata } from 'next';
import { ImporterDashboard } from './dashboard';

export const metadata: Metadata = { title: 'Importer' };
>>>>>>> track/product

export default function Page() {
  return <ImporterDashboard />;
}
