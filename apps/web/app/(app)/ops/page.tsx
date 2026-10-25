<<<<<<< HEAD
'use client';
import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';
=======
import type { Metadata } from 'next';
import { OpsQueue } from './queue';

export const metadata: Metadata = { title: 'Ops queue' };
>>>>>>> track/product

export default function Page() {
  return <OpsQueue />;
}
