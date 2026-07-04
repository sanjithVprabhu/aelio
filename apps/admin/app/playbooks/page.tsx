'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../components/Rail';
import {
  useApi,
  PageBody,
  PageHead,
  Loading,
  ErrorState,
  Empty,
  TableWrap,
  th,
  td,
} from '../components/data';
import { api } from '../lib/api';

/* Local type — matches the shape returned by GET /api/v1/t/:slug/playbooks.
   Defined inline because T1 (workflow types) runs in parallel and this page
   only consumes the list response. */
type PlaybookListItem = {
  id: string;
  version: string;
  status: 'draft' | 'shadow' | 'gradual' | 'active' | 'archived';
  deploymentMode?: 'immediate' | 'shadow' | 'gradual';
  states: number;
  publishedAt?: string | Date | null;
};

const STATUS_META: Record<
  PlaybookListItem['status'],
  { label: string; bg: string }
> = {
  draft: { label: 'Draft', bg: 'var(--ink-45)' },
  active: { label: 'Active', bg: 'var(--green)' },
  shadow: { label: 'Shadow', bg: 'var(--blue)' },
  gradual: { label: 'Gradual', bg: 'var(--amber)' },
  archived: { label: 'Archived', bg: 'var(--red)' },
};

function formatMode(mode?: PlaybookListItem['deploymentMode']): string {
  if (!mode) return '—';
  return mode === 'immediate' ? 'immediate' : mode;
}

function formatDate(d?: string | Date | null): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString();
}

export default function PlaybooksPage() {
  const router = useRouter();
  const { data, loading, error, reload } = useApi<PlaybookListItem[]>(
    '/playbooks'
  );
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  async function createDraft() {
    setCreating(true);
    setFlash(null);
    try {
      const r = await api<{ id: string; version: string; status: string }>(
        '/playbooks',
        { method: 'POST', body: {} }
      );
      setFlash(`✓ Created ${r.version}`);
      reload();
      // Auto-clear the flash after a few seconds.
      setTimeout(() => setFlash((f) => (f?.startsWith('✓ Created') ? null : f)), 3500);
    } catch (e: any) {
      setFlash(`Error: ${e?.message || 'failed to create draft'}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Playbooks" breadcrumb="Build">
      <PageBody>
        <div style={headRow}>
          <PageHead
            title="Playbooks"
            sub="Every published version. Draft a new one to iterate without touching the live behaviour."
          />
          <div style={headActions}>
            {flash && (
              <span
                style={{
                  ...flashStyle,
                  color: flash.startsWith('Error')
                    ? 'var(--red)'
                    : 'var(--green)',
                }}
              >
                {flash}
              </span>
            )}
            <button
              onClick={createDraft}
              disabled={creating}
              style={{
                ...primaryBtn,
                opacity: creating ? 0.6 : 1,
              }}
            >
              {creating ? 'Creating…' : '+ New Draft'}
            </button>
          </div>
        </div>

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <Empty
            title="No playbooks yet"
            hint={
              <>
                Click <strong>+ New Draft</strong> above to create your first
                playbook draft.
              </>
            }
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th style={th}>Version</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>States</th>
                <th style={th}>Deployment</th>
                <th style={th}>Published</th>
                <th style={{ ...th, width: 1 }} />
              </tr>
            </thead>
            <tbody>
              {data.map((p) => {
                const meta = STATUS_META[p.status] ?? STATUS_META.draft;
                const isHover = hoverId === p.id;
                return (
                  <tr
                    key={p.id}
                    onClick={() => router.push('/playbooks/' + p.id)}
                    onMouseEnter={() => setHoverId(p.id)}
                    onMouseLeave={() =>
                      setHoverId((cur) => (cur === p.id ? null : cur))
                    }
                    style={{
                      cursor: 'pointer',
                      background: isHover ? 'var(--ink-05)' : 'transparent',
                      transition: 'background 0.12s',
                    }}
                  >
                    <td
                      style={{
                        ...td,
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      v{p.version}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: 999,
                          color: '#fff',
                          background: meta.bg,
                        }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 600,
                      }}
                    >
                      {p.states}
                    </td>
                    <td
                      style={{
                        ...td,
                        color: 'var(--ink-70)',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 12,
                      }}
                    >
                      {formatMode(p.deploymentMode)}
                    </td>
                    <td
                      style={{
                        ...td,
                        color: 'var(--ink-45)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatDate(p.publishedAt)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: 'right',
                        color: 'var(--ink-22)',
                        fontSize: 16,
                        width: 1,
                      }}
                    >
                      ›
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </PageBody>
    </AppShell>
  );
}

const headRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 24,
  marginBottom: 24,
  flexWrap: 'wrap',
};

const headActions: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingTop: 4,
};

const flashStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  letterSpacing: '-0.005em',
};

const primaryBtn: React.CSSProperties = {
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 600,
  background: 'var(--ink)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};
