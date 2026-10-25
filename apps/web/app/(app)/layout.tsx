/** Authenticated area shell. Track C adds the wallet/session gate here (PLAN 4). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}
