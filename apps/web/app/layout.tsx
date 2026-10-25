import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { Providers } from '@/components/providers';
import { SiteHeader } from '@/components/site-header';
import { TestnetBadge } from '@/components/testnet-badge';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Qafila', template: '%s | Qafila' },
  description: 'Fund a real shipment for an African importer. Shared ownership, fixed profit, proof at every step on Stellar.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1b2a4a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-page font-sans text-ink antialiased">
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-20 sm:py-8">{children}</main>
          <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
            <p>Qafila is designed for Sharia compliance; formal review is pending. Built for HackMeridian 2026 on Stellar testnet with test money.</p>
            <p className="flex gap-3">
              <Link href="/verifier" className="hover:underline">
                Verifier key
              </Link>
              <Link href="/charity" className="hover:underline">
                Charity ledger
              </Link>
            </p>
          </footer>
          <TestnetBadge />
        </Providers>
      </body>
    </html>
  );
}
