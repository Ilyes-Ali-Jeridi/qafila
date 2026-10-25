import type { Metadata } from 'next';
import { ImporterDealScreen } from './deal';

export const metadata: Metadata = { title: 'My deal' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImporterDealScreen id={id} />;
}
