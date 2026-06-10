import type { Metadata } from 'next';
import { Hanken_Grotesk } from 'next/font/google';
import './globals.css';
import Shell from './components/Shell';

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-hanken',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Aelio. — Admin',
  description: 'Aelio admin & config surface',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={hanken.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
