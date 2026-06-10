'use client';

import { usePathname } from 'next/navigation';
import UserMenu from './UserMenu';

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/conversations': 'Conversations',
  '/users': 'Users',
  '/audit': 'Audit log',
  '/playbooks': 'Playbooks',
  '/playbooks/editor': 'Playbook editor',
  '/actions': 'Actions',
  '/knowledge': 'Knowledge',
  '/inbox': 'Inbox',
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
      <UserMenu />
    </header>
  );
}
