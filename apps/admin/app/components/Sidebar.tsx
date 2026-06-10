'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; label: string };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: 'Observe',
    items: [
      { href: '/', label: 'Dashboard' },
      { href: '/conversations', label: 'Conversations' },
      { href: '/inbox', label: 'Inbox' },
      { href: '/users', label: 'Users' },
      { href: '/audit', label: 'Audit log' },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/playbooks', label: 'Playbooks' },
      { href: '/actions', label: 'Actions' },
      { href: '/knowledge', label: 'Knowledge' },
    ],
  },
  {
    label: 'Connect',
    items: [
      { href: '/channels', label: 'Channels' },
      { href: '/setup', label: 'Setup wizard' },
    ],
  },
  {
    label: 'Develop',
    items: [
      { href: '/settings', label: 'Settings' },
      { href: '/playground', label: 'Playground' },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export default function Sidebar() {
  const pathname = usePathname() || '/';
  return (
    <aside className="sidebar">
      <div className="wordmark">Aelio.</div>
      {GROUPS.map((g) => (
        <nav className="nav-group" key={g.label}>
          <div className="nav-group-label">{g.label}</div>
          {g.items.map((it) => (
            <Link
              key={g.label + it.href + it.label}
              href={it.href}
              className={`nav-link ${isActive(pathname, it.href) ? 'active' : ''}`}
            >
              {it.label}
            </Link>
          ))}
        </nav>
      ))}
      <div className="nav-spacer" />
      <div className="sidebar-foot">
        Tenant · acme
        <br />
        Admin console
      </div>
    </aside>
  );
}
