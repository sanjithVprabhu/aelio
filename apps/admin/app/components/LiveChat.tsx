'use client';

import React, { useEffect, useRef, useState } from 'react';
import { chatMessage, devFollow, ChatReply } from '../lib/api';
import { I } from '../lib/icons';

type Msg = {
  id: number;
  role: 'user' | 'agent';
  text: string;
  kind?: ChatReply['kind'];
  url?: string;
};

export default function LiveChat({
  stateLabel,
  compact,
}: {
  stateLabel?: string;
  compact?: boolean;
}) {
  const [sessionId] = useState(() => 'admin-test-' + Math.random().toString(36).slice(2, 9));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<string>(stateLabel || '');
  const [pendingVerify, setPendingVerify] = useState<string | null>(null);
  const [lastUserText, setLastUserText] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput('');
    setLastUserText(text);
    setMsgs((p) => [...p, { id: Date.now(), role: 'user', text }]);
    setBusy(true);
    try {
      const res = await chatMessage(sessionId, text);
      setState(res.state);
      const verify = res.replies.find((r) => r.kind === 'magic_link' || r.kind === 'step_up');
      setPendingVerify(verify?.url || null);
      setMsgs((p) => [
        ...p,
        ...res.replies.map((r, i) => ({ id: Date.now() + i + 1, role: 'agent' as const, text: r.text, kind: r.kind, url: r.url })),
      ]);
    } catch (e: any) {
      setMsgs((p) => [...p, { id: Date.now() + 1, role: 'agent', text: 'Error: ' + (e?.message || 'request failed') }]);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!pendingVerify || busy) return;
    setBusy(true);
    try {
      await devFollow(pendingVerify);
      setPendingVerify(null);
      setMsgs((p) => [...p, { id: Date.now(), role: 'agent', text: '✓ Identity verified. Resending your message…', kind: 'text' }]);
      // resend last user message now that we're verified
      const t = lastUserText;
      const res = await chatMessage(sessionId, t || 'continue');
      setState(res.state);
      setMsgs((p) => [
        ...p,
        ...res.replies.map((r, i) => ({ id: Date.now() + i + 1, role: 'agent' as const, text: r.text, kind: r.kind, url: r.url })),
      ]);
      const v = res.replies.find((r) => r.kind === 'magic_link' || r.kind === 'step_up');
      setPendingVerify(v?.url || null);
    } catch (e: any) {
      setMsgs((p) => [...p, { id: Date.now(), role: 'agent', text: 'Verify failed: ' + (e?.message || '') }]);
    } finally {
      setBusy(false);
    }
  }

  const QUICK = ['What can you help with?', 'Get my account status', 'I want to cancel'];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--ink-05)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--ink-45)' }}>
          State: <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{state || stateLabel || '—'}</span>
        </div>
        <div
          onClick={() => {
            setMsgs([]);
            setPendingVerify(null);
          }}
          style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-22)', cursor: 'pointer', userSelect: 'none' }}
        >
          Reset
        </div>
      </div>

      <div ref={boxRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msgs.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: 0.4, paddingTop: 40 }}>
            <I.chat size={28} />
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-45)', textAlign: 'center', lineHeight: 1.5 }}>
              Type a message to talk to
              <br />
              the live agent
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 4 }}>
            <div
              style={{
                maxWidth: '92%',
                padding: '8px 11px',
                fontSize: 12.5,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                borderRadius: m.role === 'user' ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
                background: m.role === 'user' ? 'var(--ink)' : 'var(--bg)',
                color: m.role === 'user' ? 'var(--white)' : 'var(--ink)',
                border: m.role === 'user' ? 'none' : '1px solid var(--ink-10)',
              }}
            >
              {m.text}
            </div>
            {m.role === 'agent' && (m.kind === 'magic_link' || m.kind === 'step_up') && m.url === pendingVerify && (
              <button
                onClick={verify}
                disabled={busy}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: '5px 12px',
                  borderRadius: 7,
                  background: 'var(--blue)',
                  color: 'var(--white)',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {m.kind === 'step_up' ? 'Complete step-up' : 'Verify identity'}
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{ padding: '10px 14px', borderRadius: '10px 10px 10px 3px', background: 'var(--bg)', border: '1px solid var(--ink-10)', display: 'flex', gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ink-22)', animation: `pulse 1.2s ${i * 0.22}s infinite` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {msgs.length === 0 && (
        <div style={{ padding: '0 14px 8px', flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {QUICK.map((q) => (
            <div
              key={q}
              onClick={() => !busy && send(q)}
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                padding: '4px 9px',
                borderRadius: 20,
                border: '1px solid var(--ink-10)',
                background: 'var(--bg)',
                color: 'var(--ink-70)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              {q}
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--ink-05)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send(input);
            }}
            placeholder="Type as the end user…"
            style={{
              flex: 1,
              padding: '8px 10px',
              fontSize: 12.5,
              border: '1px solid var(--ink-10)',
              borderRadius: 8,
              background: 'var(--white)',
              color: 'var(--ink)',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || busy}
            style={{
              width: 34,
              height: 34,
              background: input.trim() && !busy ? 'var(--ink)' : 'var(--ink-10)',
              border: 'none',
              borderRadius: 8,
              cursor: input.trim() && !busy ? 'pointer' : 'default',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              color: input.trim() && !busy ? 'var(--white)' : 'var(--ink-22)',
            }}
          >
            <I.arrow />
          </button>
        </div>
      </div>
    </div>
  );
}
