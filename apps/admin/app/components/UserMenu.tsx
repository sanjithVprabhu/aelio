'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { me, getToken, clearToken, type AuthUser } from '../lib/client';

function initials(name: string, email: string): string {
  const base = (name || email || '?').trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export default function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    if (!getToken()) {
      setChecked(true);
      return;
    }
    me()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch(() => {
        if (alive) {
          clearToken();
          setUser(null);
        }
      })
      .finally(() => {
        if (alive) setChecked(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function logout() {
    clearToken();
    setUser(null);
    setOpen(false);
    router.refresh();
  }

  if (!checked) return <span className="topbar-meta">acme · production</span>;

  if (!user) {
    return (
      <Link className="btn btn-ghost btn-sm" href="/login">
        Sign in
      </Link>
    );
  }

  return (
    <div className="usermenu" ref={ref}>
      <button className="usermenu-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{initials(user.name, user.email)}</span>
        <span>{user.name || user.email}</span>
      </button>
      {open && (
        <div className="usermenu-pop">
          <div className="who">
            <div className="nm">{user.name || '—'}</div>
            <div className="em">{user.email}</div>
            <div className="em" style={{ marginTop: 4, textTransform: 'capitalize' }}>
              {user.role}
            </div>
          </div>
          <Link className="menu-item" href="/settings" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <button className="menu-item" onClick={logout}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
