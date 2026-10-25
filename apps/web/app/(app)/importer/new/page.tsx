import type { Metadata } from 'next';
import { NewDealWizard } from './wizard';

export const metadata: Metadata = { title: 'New deal' };

export default function Page() {
  return <NewDealWizard />;
}
