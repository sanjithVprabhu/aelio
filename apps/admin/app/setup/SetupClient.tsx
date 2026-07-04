'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../lib/api';

const SCREENS = ['personalise', 'verify', 'connect', 'channels', 'cooking', 'live'] as const;
type Screen = (typeof SCREENS)[number];

const STEP_KEY: Record<Screen, string> = {
  personalise: 'configure_identity',
  verify: 'configure_identity',
  connect: 'connect_api',
  channels: 'connect_channel',
  cooking: 'review_playbook',
  live: 'go_live',
};

const COOKING_LINES = [
  'reading your spec.',
  'mapping every endpoint.',
  'learning your workflows.',
  'understanding your users.',
  'wiring the interface.',
  'connecting your channels.',
  'ready.',
];

export default function SetupClient() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>('personalise');

  const goTo = (s: Screen) => {
    setScreen(s);
    api('/onboarding/state', { method: 'POST', body: { currentStep: STEP_KEY[s] } }).catch(() => {});
  };

  const idx = SCREENS.indexOf(screen);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'clamp(3rem, 8vh, 6rem) clamp(1.5rem, 8vw, 5rem)',
        }}
      >
        <div key={screen} style={{ width: '100%', maxWidth: 560, animation: 'fadeUp 0.45s var(--ease) forwards' }}>
          {screen === 'personalise' && <Personalise onNext={() => goTo('verify')} />}
          {screen === 'verify' && <Verify onNext={() => goTo('connect')} onChange={() => router.push('/signup')} />}
          {screen === 'connect' && <Connect onNext={() => goTo('channels')} />}
          {screen === 'channels' && <Channels onNext={() => goTo('cooking')} />}
          {screen === 'cooking' && <Cooking onDone={() => goTo('live')} />}
          {screen === 'live' && <Live onDashboard={() => router.push('/')} />}
        </div>
      </main>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '1.6rem 2rem 2rem' }}>
        {SCREENS.map((sid, i) => (
          <div
            key={sid}
            onClick={() => goTo(sid)}
            style={{
              height: 7,
              borderRadius: 100,
              width: i === idx ? 24 : 7,
              background: i === idx ? 'var(--black)' : i < idx ? 'var(--ink-45)' : 'var(--ink-22)',
              transition: 'width 0.35s var(--ease), background 0.35s var(--ease)',
              cursor: 'pointer',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── shared bits ── */
const obTitle: React.CSSProperties = {
  fontSize: 'clamp(1.7rem, 3.5vw, 2.2rem)',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  lineHeight: 1.12,
  marginBottom: '1.8rem',
};
const obSub: React.CSSProperties = { fontSize: '1rem', color: 'var(--ink-70)', marginTop: '-1.2rem', marginBottom: '1.8rem', maxWidth: '44ch' };
const obInput: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '1rem',
  color: 'var(--ink)',
  background: 'var(--white)',
  border: '1px solid var(--ink-22)',
  borderRadius: 8,
  padding: '0.76em 1em',
  width: '100%',
  outline: 'none',
};
const obFieldLabel: React.CSSProperties = { fontSize: '0.97rem', fontWeight: 500, color: 'var(--ink)' };

function NextBtn({ onClick, children = 'Next', disabled }: { onClick: () => void; children?: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5em',
        fontFamily: 'inherit',
        fontSize: '1rem',
        fontWeight: 600,
        background: 'var(--black)',
        color: 'var(--white)',
        border: 'none',
        borderRadius: 10,
        padding: '0.78em 1.6em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        marginTop: '0.5rem',
        opacity: disabled ? 0.5 : 1,
        lineHeight: 1,
      }}
    >
      {children} <span style={{ fontSize: '1em' }}>→</span>
    </button>
  );
}

function Skip({ onClick }: { onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{ display: 'inline-block', marginLeft: '1rem', fontSize: '0.9rem', color: 'var(--ink-45)', cursor: 'pointer' }}
    >
      Skip for now
    </span>
  );
}

function Personalise({ onNext }: { onNext: () => void }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div>
      <h1 style={obTitle}>Help us personalise your experience</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.15rem' }}>
        <label style={obFieldLabel}>
          What's your name? <span style={{ fontSize: '0.82rem', fontWeight: 400, color: 'var(--ink-45)' }}>(optional)</span>
        </label>
        <input style={obInput} placeholder="First name" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.15rem' }}>
        <label style={obFieldLabel}>What's your preferred language?</label>
        <select style={obInput}>
          <option>English</option>
          <option>Hindi</option>
          <option>Spanish</option>
          <option>French</option>
        </select>
      </div>
      <label style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start', marginBottom: '1.4rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ width: 20, height: 20, marginTop: 2, accentColor: 'var(--black)', flexShrink: 0 }}
        />
        <span style={{ fontSize: '0.93rem', color: 'var(--ink-70)', lineHeight: 1.5 }}>
          By checking this box, you confirm you are authorised to set up an AI interface on behalf of your platform.
        </span>
      </label>
      <NextBtn onClick={onNext} disabled={!agreed} />
    </div>
  );
}

function Verify({ onNext, onChange }: { onNext: () => void; onChange: () => void }) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: '1.24rem', letterSpacing: '-0.01em', marginBottom: '2.5rem' }}>Aelio.</div>
      <div style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--cream)', display: 'grid', placeItems: 'center', marginBottom: '1.5rem' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      </div>
      <h1 style={obTitle}>Check your inbox</h1>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.6em',
          background: 'var(--white)',
          border: '1px solid var(--ink-22)',
          borderRadius: 100,
          padding: '0.45em 1em 0.45em 0.75em',
          fontSize: '0.95rem',
          fontWeight: 500,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3a9c5a' }} />
        <span>admin@acme.com</span>
      </div>
      <p style={{ ...obSub, marginTop: '1.4rem', marginBottom: '1.4rem' }}>
        We sent a confirmation link to your email. Click it to activate your account and continue setting up Aelio.
      </p>
      <NextBtn onClick={onNext}>I've confirmed</NextBtn>
      <div style={{ marginTop: '1.2rem' }}>
        <a onClick={onChange} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}>
          Use a different email
        </a>
      </div>
    </div>
  );
}

function Connect({ onNext }: { onNext: () => void }) {
  const [raw, setRaw] = useState('');
  const [url, setUrl] = useState('');
  const [loaded, setLoaded] = useState<{ count: number; format: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function ingest() {
    setErr(null);
    setBusy(true);
    try {
      const body: any = { exposeAll: false };
      if (raw.trim()) body.raw = raw.trim();
      else if (url.trim()) body.baseUrl = url.trim();
      else {
        setErr('Paste an OpenAPI spec or enter a URL first.');
        setBusy(false);
        return;
      }
      const res = await api<{ format: string; actionCount: number }>('/specs', { method: 'POST', body });
      setLoaded({ count: res.actionCount, format: res.format });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Spec ingest failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={obTitle}>Connect your platform</h1>
      <p style={obSub}>Drop in your OpenAPI spec. Aelio will learn your product in minutes — no code required.</p>

      <div
        onClick={() => fileRef.current?.click()}
        style={{
          border: `1.5px ${loaded ? 'solid var(--black)' : 'dashed var(--ink-22)'}`,
          borderRadius: 10,
          padding: '2rem 1.5rem',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: '0.9rem',
          background: loaded ? 'rgba(10,10,10,0.02)' : 'var(--white)',
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".json,.yaml,.yml"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            f.text().then((t) => setRaw(t));
          }}
        />
        <div style={{ fontSize: '1.4rem', marginBottom: '0.5rem', opacity: loaded ? 1 : 0.4 }}>{loaded ? '📄' : '↑'}</div>
        {loaded ? (
          <>
            <p style={{ fontSize: '0.92rem', color: 'var(--ink-70)' }}>
              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{loaded.format}</span> spec loaded
            </p>
            <small style={{ fontSize: '0.8rem', color: '#3a9c5a', fontWeight: 600, marginTop: '0.25rem', display: 'block' }}>
              ✓ {loaded.count} actions discovered
            </small>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.92rem', color: 'var(--ink-70)' }}>
              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Click to upload</span> or paste below
            </p>
            <small style={{ fontSize: '0.8rem', color: 'var(--ink-45)', marginTop: '0.25rem', display: 'block' }}>
              openapi.yaml · openapi.json · max 10MB
            </small>
          </>
        )}
      </div>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="…or paste your OpenAPI JSON here"
        style={{ ...obInput, minHeight: 90, fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem', resize: 'vertical', marginBottom: '0.7rem' }}
      />

      <p style={{ textAlign: 'left', fontSize: '0.82rem', color: 'var(--ink-45)', margin: '0.4rem 0 0.7rem' }}>or enter a public URL</p>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        type="url"
        placeholder="https://api.yourapp.com/openapi.json"
        style={{ ...obInput, marginBottom: '1.4rem' }}
      />

      {err && <div style={{ color: 'var(--red)', fontSize: '0.88rem', marginBottom: '0.8rem', fontWeight: 500 }}>{err}</div>}

      <div style={{ display: 'flex', alignItems: 'center' }}>
        {loaded ? (
          <NextBtn onClick={onNext}>Continue</NextBtn>
        ) : (
          <NextBtn onClick={ingest} disabled={busy}>
            {busy ? 'Ingesting…' : 'Ingest spec'}
          </NextBtn>
        )}
        <Skip onClick={onNext} />
      </div>
    </div>
  );
}

const CH = [
  { id: 'wa', name: 'WhatsApp', desc: 'Meet users where they already message', icon: '💬', bg: '#E7F7EC' },
  { id: 'sl', name: 'Slack', desc: 'For teams that live in Slack', icon: '⚡', bg: '#F0EBFA' },
  { id: 'em', name: 'Embedded chat', desc: 'Right inside your product interface', icon: '⬡', bg: 'var(--cream)' },
];

function Channels({ onNext }: { onNext: () => void }) {
  const [sel, setSel] = useState<Record<string, boolean>>({ wa: true });
  return (
    <div>
      <h1 style={obTitle}>Where should Aelio live?</h1>
      <p style={obSub}>Pick the channels your users are already on. You can change this any time.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.2rem' }}>
        {CH.map((c) => {
          const on = !!sel[c.id];
          return (
            <div
              key={c.id}
              onClick={() => setSel((s) => ({ ...s, [c.id]: !s[c.id] }))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                background: 'var(--white)',
                border: `1.5px solid ${on ? 'var(--black)' : 'var(--ink-22)'}`,
                boxShadow: on ? '0 0 0 3px rgba(10,10,10,0.07)' : 'none',
                borderRadius: 10,
                padding: '0.9rem 1.1rem',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: '1.1rem', flexShrink: 0, background: c.bg }}>
                {c.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.96rem', fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: '0.81rem', color: 'var(--ink-70)' }}>{c.desc}</div>
              </div>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: `1.5px solid ${on ? 'var(--black)' : 'var(--ink-22)'}`,
                  background: on ? 'var(--black)' : 'transparent',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  color: 'var(--white)',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                }}
              >
                {on ? '✓' : ''}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <NextBtn onClick={onNext}>Continue</NextBtn>
        <Skip onClick={onNext} />
      </div>
    </div>
  );
}

function Cooking({ onDone }: { onDone: () => void }) {
  const [line, setLine] = useState('');
  const [pct, setPct] = useState(0);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (i >= COOKING_LINES.length) {
        timer = setTimeout(onDone, 600);
        return;
      }
      setFade(true);
      setTimeout(() => {
        setLine(COOKING_LINES[i]);
        setFade(false);
        setPct(Math.round(((i + 1) / COOKING_LINES.length) * 100));
        i += 1;
        timer = setTimeout(step, 1400);
      }, 300);
    };
    timer = setTimeout(step, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ fontSize: '1.8rem', fontWeight: 700, letterSpacing: '-0.01em', marginBottom: '3rem' }}>Aelio.</div>
      <div style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.2, marginBottom: '2.5rem', minHeight: '3.2em', display: 'flex', flexDirection: 'column', gap: '0.15em' }}>
        <span style={{ color: 'var(--ink-45)', fontWeight: 500, fontSize: '0.72em', letterSpacing: '0.01em', textTransform: 'uppercase' }}>Hold tight. Aelio is</span>
        <span style={{ display: 'block', color: 'var(--black)', minHeight: '1.3em', opacity: fade ? 0 : 1, transform: fade ? 'translateY(6px)' : 'none', transition: 'opacity 0.35s ease, transform 0.35s ease' }}>
          {line}
        </span>
      </div>
      <div style={{ width: '100%', maxWidth: 280, height: 3, background: 'var(--ink-10)', borderRadius: 100, overflow: 'hidden', marginBottom: '1.2rem' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--black)', borderRadius: 100, transition: 'width 0.4s var(--ease)' }} />
      </div>
      <p style={{ fontSize: '0.88rem', color: 'var(--ink-45)' }}>This takes about 30 seconds.</p>
    </div>
  );
}

function Live({ onDashboard }: { onDashboard: () => void }) {
  const [checklist, setChecklist] = useState<{ label: string; ok: boolean }[] | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ ready: boolean; checklist: any[] }>('/onboarding/go-live', { method: 'POST', body: {} })
      .then((r) => {
        setReady(r.ready);
        setChecklist(
          (r.checklist || []).map((c: any) => ({
            label: c.label || c.step || c.key || String(c),
            ok: c.ok ?? c.done ?? c.complete ?? true,
          }))
        );
      })
      .catch(() => {
        setReady(true);
        setChecklist([{ label: 'Setup complete', ok: true }]);
      });
  }, []);
  return (
    <div>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--black)', color: 'var(--white)', display: 'grid', placeItems: 'center', fontSize: '1.3rem', marginBottom: '1.5rem' }}>
        ✓
      </div>
      <h1 style={obTitle}>Aelio is ready.</h1>
      <p style={obSub}>Your conversational interface is live. Users can start talking to your platform right now.</p>

      {checklist && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--ink-22)', borderRadius: 10, padding: '0.4rem 1rem', marginBottom: '1.2rem' }}>
          {checklist.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < checklist.length - 1 ? '1px solid var(--ink-05)' : 'none' }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--white)',
                  background: c.ok ? 'var(--green)' : 'var(--ink-22)',
                  flexShrink: 0,
                }}
              >
                {c.ok ? '✓' : '·'}
              </span>
              <span style={{ fontSize: '0.92rem', color: 'var(--ink-70)' }}>{c.label}</span>
            </div>
          ))}
        </div>
      )}

      <NextBtn onClick={onDashboard}>Go to dashboard</NextBtn>
    </div>
  );
}
