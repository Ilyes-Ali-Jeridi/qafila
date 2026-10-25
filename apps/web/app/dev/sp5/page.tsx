import { notFound } from 'next/navigation';
import { Sp5Harness } from './harness';

/** SP5 spike harness (PLAN 3.2): development only, never rendered in production. */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Sp5Harness />;
}
