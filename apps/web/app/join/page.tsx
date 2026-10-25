import type { Metadata } from 'next';
import { JoinScreen } from './join';

export const metadata: Metadata = { title: 'Join' };

/** S6 QR join flow (PLAN 9.3). Renders only when FF_QR_JOIN is on. */
export default function Page() {
  return <JoinScreen />;
}
