<<<<<<< HEAD
'use client';
import { z } from 'zod';
import { ApiScreen } from '@/components/not-built';
=======
import type { Metadata } from 'next';
import { NewDealWizard } from './wizard';

export const metadata: Metadata = { title: 'New deal' };
>>>>>>> track/product

export default function Page() {
  return <NewDealWizard />;
}
