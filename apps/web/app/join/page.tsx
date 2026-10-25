import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JoinScreen } from './join';
import { SkeletonCard } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Join' };

/** S6 QR join flow (PLAN 9.3). Renders only when FF_QR_JOIN is on. */
export default function Page() {
  return (
    <Suspense fallback={<SkeletonCard lines={4} />}>
      <JoinScreen />
    </Suspense>
  );
}
