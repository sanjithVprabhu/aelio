import Link from 'next/link';
import { AppShell } from './components/Rail';
import { Card } from './components/ui';
import { I } from './lib/icons';

export default function DashboardPage() {
  return (
    <AppShell title="Dashboard">
      <div style={{ padding: '32px 36px', maxWidth: 900 }}>
        {/* Welcome card */}
        <Card pad={28} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-45)', marginBottom: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Tenant
              </div>
              <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: '0 0 4px' }}>
                acme-corp
              </h1>
              <p style={{ margin: '0 0 18px', color: 'var(--ink-45)', fontSize: 14, lineHeight: 1.5 }}>
                Welcome to the Aelio control plane. Manage playbooks, monitor conversations, and configure your agents.
              </p>
              <Link
                href="/playbooks"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  borderRadius: 10,
                  background: 'var(--ink)',
                  color: 'var(--white)',
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                <I.flow size={16} />
                Manage Playbooks
              </Link>
            </div>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: 16,
                background: 'var(--cream)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 28,
                fontWeight: 800,
                color: 'var(--ink-70)',
                flexShrink: 0,
              }}
            >
              AC
            </div>
          </div>
        </Card>

        {/* Quick links */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <QuickLinkCard href="/conversations" icon="chat" label="Conversations" desc="View recent conversations and chat history" />
          <QuickLinkCard href="/specs" icon="code" label="Specs" desc="Manage API specs and actions" />
          <QuickLinkCard href="/inbox" icon="bell" label="Inbox" desc="Review flagged messages and alerts" />
          <QuickLinkCard href="/settings" icon="gear" label="Settings" desc="Tenant and team configuration" />
        </div>
      </div>
    </AppShell>
  );
}

function QuickLinkCard({ href, icon, label, desc }: { href: string; icon: keyof typeof I; label: string; desc: string }) {
  const Icon = I[icon];
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <Card
        pad={20}
        style={{
          cursor: 'pointer',
          transition: 'box-shadow 0.15s, border-color 0.15s',
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ color: 'var(--ink-45)', flexShrink: 0, marginTop: 1 }}>
          <Icon size={18} />
        </span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-45)', lineHeight: 1.4 }}>{desc}</div>
        </div>
      </Card>
    </Link>
  );
}
