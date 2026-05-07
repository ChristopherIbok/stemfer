import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: { default: 'Stemfer', template: '%s | Stemfer' },
  description: 'Cloud-based audio collaboration platform for music producers and studios.',
  keywords: ['audio', 'stems', 'DAW', 'studio', 'collaboration', 'music production'],
  openGraph: {
    title:       'Stemfer',
    description: 'Transfer, manage, and sync your audio projects in the cloud.',
    type:        'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen bg-surface text-white antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
