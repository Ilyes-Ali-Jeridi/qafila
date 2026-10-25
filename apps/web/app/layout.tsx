import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { TestnetBadge } from '@/components/testnet-badge';

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: 'variable', variable: '--font-bricolage', display: 'swap', axes: ['opsz'] });
const body = Figtree({ subsets: ['latin'], variable: '--font-figtree', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Qafila', template: '%s | Qafila' },
  description: 'Fund a real shipment for an African importer. Shared ownership, fixed profit, proof at every step on Stellar.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#070a12', colorScheme: 'dark', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} data-theme="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-page font-sans text-ink antialiased">
        <div aria-hidden className="page-glow pointer-events-none fixed inset-x-0 top-0 -z-10 h-[60vh]" />
        <Providers>
          <SiteHeader />
          <main className="relative mx-auto w-full max-w-6xl px-4 py-6 pb-24 sm:py-8">{children}</main>
          <SiteFooter />
          <TestnetBadge />
        </Providers>
        <div aria-hidden className="grain" />
      </body>
    </html>
  );
}
