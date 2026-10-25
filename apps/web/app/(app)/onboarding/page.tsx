import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Onboarding } from './onboarding';
import { SkeletonCard } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Create my wallet' };

export default function Page() {
  return (
    <Suspense fallback={<SkeletonCard lines={4} />}>
      <Onboarding />
    </Suspense>
  );
}
