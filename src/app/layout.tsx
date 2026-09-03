import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Header, Footer } from '@/components/Chrome';
import { dataAsOf } from '@/lib/queries';
import { kickoff } from '@/lib/fmt';

const sans = IBM_Plex_Sans({
  subsets: ['latin'], weight: ['400', '500', '600', '700'],
  variable: '--font-sans', display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'], weight: ['400', '500', '600'],
  variable: '--font-mono', display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://www.truevalueengine.com'),
  title: { default: 'True Value Engine', template: '%s' },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let asOf: string | undefined;
  try {
    const d = await dataAsOf();
    if (d?.odds) asOf = kickoff(d.odds);
  } catch {
    // The footer stamp is decoration; a database hiccup must not take the whole
    // page down here, because the page body has its own error handling.
  }
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Header />
        <main>{children}</main>
        <Footer asOf={asOf} />
      </body>
    </html>
  );
}
