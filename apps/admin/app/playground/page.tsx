'use client';

import { useEffect, useRef, useState } from 'react';

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SLUG = 'acme';

type Reply = { kind: 'text' | 'magic_link' | 'step_up' | 'handoff' | string; text?: string; url?: string };

type Bubble =
  | { role: 'user'; text: string }
  | { role: 'assistant'; replies: Reply[] };

type ChatResponse = {
  replies: Reply[];
  state?: string;
  actions?: unknown;
  needsVerification?: boolean;
};

function newSessionId(): string {
  return 'pg-' + Math.random().toString(36).slice(2, 10);
}

export default function PlaygroundPage() {
  const [sessionId] = useState(newSessionId);
  const [input, setInput] = useState('');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [state, setState] = useState<string>('—');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles, loading]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError(null);
    setBubbles((b) => [...b, { role: 'user', text }]);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/chat/${SLUG}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, text }),
      });
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      const data = (await res.json()) as ChatResponse;
      setBubbles((b) => [...b, { role: 'assistant', replies: data.replies ?? [] }]);
      if (data.state) setState(data.state);
      setNeedsVerification(Boolean(data.needsVerification));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h2>Playground</h2>
        <p>Chat against the live assistant for tenant acme. Session is ephemeral.</p>
      </div>

      <div className="pg-wrap">
        <div className="pg-head">
          <span className="title">Live chat</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {needsVerification && <span className="badge badge-soft status-warn">needs verification</span>}
            <span className="chip">state · {state}</span>
          </span>
        </div>

        <div className="pg-stream" ref={streamRef}>
          {bubbles.length === 0 && (
            <p className="muted" style={{ textAlign: 'center', margin: 'auto' }}>
              Say hello to start a conversation.
            </p>
          )}

          {bubbles.map((b, i) =>
            b.role === 'user' ? (
              <div className="turn user" key={i}>
                <div className="bubble">{b.text}</div>
              </div>
            ) : (
              <div className="turn assistant" key={i}>
                {b.replies.map((r, j) => (
                  <ReplyView reply={r} key={j} />
                ))}
              </div>
            ),
          )}

          {loading && (
            <div className="turn assistant">
              <div className="bubble muted">…</div>
            </div>
          )}

          {error && (
            <div className="turn assistant">
              <div className="bubble status-bad">
                API offline — start apps/api. ({error})
              </div>
            </div>
          )}
        </div>

        <form className="pg-form" onSubmit={send}>
          <input
            className="pg-input"
            placeholder="Type a message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button className="btn" type="submit" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </>
  );
}

function ReplyView({ reply }: { reply: Reply }) {
  if (reply.kind === 'magic_link' || reply.kind === 'step_up') {
    const label = reply.kind === 'magic_link' ? 'Open magic link' : 'Complete step-up';
    return (
      <div style={{ marginBottom: 8 }}>
        {reply.text && <div className="bubble" style={{ marginBottom: 8 }}>{reply.text}</div>}
        {reply.url ? (
          <a className="btn-action" href={reply.url} target="_blank" rel="noopener noreferrer">
            {label} ↗
          </a>
        ) : (
          <span className="badge badge-soft status-warn">{label} (no url)</span>
        )}
      </div>
    );
  }

  if (reply.kind === 'handoff') {
    return (
      <div className="bubble" style={{ marginBottom: 8 }}>
        <span className="badge badge-soft status-warn" style={{ marginBottom: 8, display: 'inline-flex' }}>
          handoff
        </span>
        <div>{reply.text || 'Handed off to a human agent.'}</div>
      </div>
    );
  }

  return <div className="bubble" style={{ marginBottom: 8 }}>{reply.text}</div>;
}
