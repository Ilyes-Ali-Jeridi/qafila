import type { Metadata } from 'next';
import { OpsReview } from './review';

export const metadata: Metadata = { title: 'Review deal' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpsReview id={id} />;
}
