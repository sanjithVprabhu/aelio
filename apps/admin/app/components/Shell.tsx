'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

const BARE_ROUTES = ['/login', '/signup', '/setup'];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const bare = BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));

  if (bare) return <>{children}</>;

  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Topbar />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
