'use client';

import { usePathname } from 'next/navigation';

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/conversations': 'Conversations',
  '/users': 'Users',
  '/audit': 'Audit log',
  '/playbooks': 'Playbooks',
  '/actions': 'Actions',
  '/knowledge': 'Knowledge',
  '/channels': 'Channels',
  '/settings': 'Settings',
  '/playground': 'Playground',
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/conversations/')) return 'Conversation';
  const seg = pathname.split('/').filter(Boolean)[0];
  if (seg && TITLES['/' + seg]) return TITLES['/' + seg];
  return 'Aelio Admin';
}

export default function Topbar() {
  const pathname = usePathname() || '/';
  return (
    <header className="topbar">
      <h1>{titleFor(pathname)}</h1>
      <div className="topbar-meta">acme · production</div>
    </header>
  );
}
