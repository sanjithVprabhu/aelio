'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { I, IconKey } from '../lib/icons';
import { clearToken } from '../lib/api';

type NavItem = { id: string; label: string; icon: IconKey; href: string };
type NavSection = { section: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    section: 'OBSERVE',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'grid', href: '/' },
      { id: 'convos', label: 'Conversations', icon: 'chat', href: '/conversations' },
      { id: 'customers', label: 'Users', icon: 'users', href: '/users' },
      { id: 'audit', label: 'Audit log', icon: 'log', href: '/audit' },
    ],
  },
  {
    section: 'BUILD',
    items: [
      { id: 'playbooks', label: 'Playbooks', icon: 'flow', href: '/playbooks' },
      { id: 'inbox', label: 'Inbox', icon: 'bell', href: '/inbox' },
      { id: 'knowledge', label: 'Knowledge', icon: 'brain', href: '/knowledge' },
    ],
  },
  {
    section: 'CONNECT',
    items: [
      { id: 'channels', label: 'Channels', icon: 'plug', href: '/channels' },
      { id: 'specs', label: 'Specs', icon: 'code', href: '/specs' },
    ],
  },
  {
    section: 'DEVELOP',
    items: [{ id: 'settings', label: 'Settings', icon: 'gear', href: '/settings' }],
  },
];

export function Rail({ open, activeHref }: { open: boolean; activeHref?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeHref ?? pathname;

  return (
    <aside
      style={{
        width: open ? 226 : 52,
        flexShrink: 0,
        background: 'var(--white)',
        borderRight: '1px solid var(--ink-10)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100%',
        transition: 'width 0.22s var(--ease)',
      }}
    >
      <div style={{ padding: open ? '18px 18px 14px' : '14px 8px 10px', flexShrink: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            marginBottom: open ? 16 : 12,
            justifyContent: open ? 'flex-start' : 'center',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: 'var(--black)',
              color: 'var(--white)',
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            A.
          </div>
          {open && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.2 }}>Aelio.</div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-45)',
                }}
              >
                Control Plane
              </div>
            </div>
          )}
        </div>
        {open && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--ink-10)',
              background: 'var(--bg)',
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: 'var(--cream)',
                fontSize: 11,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                color: 'var(--ink-70)',
                border: '1px solid var(--ink-10)',
              }}
            >
              AC
            </div>
            <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1, letterSpacing: '-0.01em' }}>acme-corp</span>
          </div>
        )}
      </div>
      <nav style={{ flex: 1, overflowY: 'auto', padding: open ? '2px 10px 10px' : '2px 6px 10px' }}>
        {NAV.map((sec) => (
          <div key={sec.section} style={{ marginBottom: 4 }}>
            {open ? (
              <span
                style={{
                  display: 'block',
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-45)',
                  padding: '14px 8px 6px',
                }}
              >
                {sec.section}
              </span>
            ) : (
              <div style={{ height: 10 }} />
            )}
            {sec.items.map((it) => {
              const Ico = I[it.icon];
              const on = active === it.href || (it.href !== '/' && active.startsWith(it.href));
              return (
                <Link
                  key={it.id}
                  href={it.href}
                  title={!open ? it.label : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: open ? 'flex-start' : 'center',
                    gap: 11,
                    padding: open ? '8px 10px' : '9px',
                    borderRadius: 9,
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontSize: 14.5,
                    fontWeight: on ? 600 : 400,
                    color: on ? 'var(--ink)' : 'var(--ink-70)',
                    background: on ? 'var(--ink-05)' : 'transparent',
                    transition: 'background 0.15s',
                    marginBottom: 1,
                  }}
                >
                  <span style={{ opacity: on ? 1 : 0.55, display: 'flex', flexShrink: 0 }}>
                    <Ico />
                  </span>
                  {open && it.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div
        style={{
          padding: open ? '12px 14px 16px' : '10px 6px 14px',
          borderTop: '1px solid var(--ink-10)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => {
            clearToken();
            router.push('/login');
          }}
          title="Sign out"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: open ? 'flex-start' : 'center',
            gap: 11,
            cursor: 'pointer',
            borderRadius: 9,
            padding: open ? '6px 8px' : '6px',
            background: 'none',
            border: 'none',
            fontFamily: 'inherit',
            transition: 'background 0.15s',
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'var(--black)',
              fontSize: 13,
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              color: 'var(--white)',
              position: 'relative',
            }}
          >
            AM
            <span
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--green)',
                border: '2px solid var(--white)',
              }}
            />
          </div>
          {open && (
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em' }}>Acme Admin</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-45)' }}>Sign out</div>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}

/** Full chrome shell for the inner nav screens (everything except the builder dashboard,
 *  which renders its own canvas chrome). Provides rail + a topbar with title + breadcrumb. */
export function AppShell({
  title,
  breadcrumb,
  children,
  actions,
}: {
  title: string;
  breadcrumb?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden' }}>
      <Rail open={open} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            height: 52,
            background: 'var(--white)',
            borderBottom: '1px solid var(--ink-10)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 18px 0 14px',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setOpen((o) => !o)}
            style={{
              width: 32,
              height: 32,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink-70)',
              borderRadius: 7,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <I.menu />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.015em' }}>{title}</span>
            {breadcrumb && (
              <>
                <span style={{ color: 'var(--ink-22)' }}>›</span>
                <span style={{ fontSize: 13, color: 'var(--ink-45)' }}>{breadcrumb}</span>
              </>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {actions}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>{children}</div>
      </div>
    </div>
  );
}
