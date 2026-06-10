import type { Metadata } from 'next';
import { Hanken_Grotesk } from 'next/font/google';
import './globals.css';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';

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
        <div className="shell">
          <Sidebar />
          <div className="main">
            <Topbar />
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
