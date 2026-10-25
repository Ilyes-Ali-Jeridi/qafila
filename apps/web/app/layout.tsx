import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { Providers } from '@/components/providers';
import { TestnetBadge } from '@/components/testnet-badge';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Qafila',
  description: 'Fund a real shipment for an African importer. Shared ownership, fixed profit, proof at every step on Stellar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-page font-sans text-ink antialiased">
        <Providers>
          <header className="border-b border-sand-200">
            <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                Qafila
              </Link>
              <div className="flex items-center gap-4 text-sm">
                <Link href="/invest" className="hover:underline">
                  Deals
                </Link>
                <Link href="/charity" className="hover:underline">
                  Charity ledger
                </Link>
                <Link href="/onboarding" className="rounded-md bg-indigo px-3 py-1.5 text-white hover:bg-indigo-700">
                  Create my wallet
                </Link>
              </div>
            </nav>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 py-10 text-xs text-ink-muted">
            Qafila is designed for Sharia compliance; formal review is pending. Built for HackMeridian 2026 on Stellar testnet with test money.
          </footer>
          <TestnetBadge />
        </Providers>
      </body>
    </html>
  );
}
