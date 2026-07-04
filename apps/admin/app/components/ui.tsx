'use client';

import React from 'react';

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size, borderWidth: Math.max(2, size / 7) }}
    />
  );
}

export function Card({
  children,
  style,
  pad = 22,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  pad?: number;
}) {
  return (
    <div
      style={{
        background: 'var(--white)',
        border: '1px solid var(--ink-10)',
        borderRadius: 12,
        padding: pad,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        background: 'var(--red-bg)',
        border: '1px solid rgba(196,56,56,.22)',
        color: 'var(--red)',
        borderRadius: 10,
        padding: '12px 16px',
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      {message}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = 'dark',
  disabled,
  type = 'button',
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'dark' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  style?: React.CSSProperties;
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 14px',
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'opacity 0.15s, background 0.15s',
    border: '1px solid transparent',
    ...style,
  };
  const variants: Record<string, React.CSSProperties> = {
    dark: { background: 'var(--ink)', color: 'var(--white)' },
    ghost: { background: 'var(--white)', color: 'var(--ink-70)', borderColor: 'var(--ink-10)' },
    danger: { background: 'var(--red)', color: 'var(--white)' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  );
}

export function Toggle({ on, onClick, disabled }: { on: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 34,
        height: 19,
        borderRadius: 999,
        background: on ? 'var(--green)' : 'var(--ink-10)',
        position: 'relative',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
        transition: 'background 0.15s',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 17 : 2,
          width: 15,
          height: 15,
          borderRadius: '50%',
          background: 'var(--white)',
          transition: 'left 0.15s ease',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-70)' }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: 'var(--ink-45)' }}>{hint}</span>}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--ink-22)',
  borderRadius: 8,
  padding: '9px 12px',
  fontSize: 13.5,
  fontFamily: 'inherit',
  background: 'var(--white)',
  color: 'var(--ink)',
  outline: 'none',
};

export function TierBadge({ tier }: { tier: number }) {
  const colors = ['var(--green)', 'var(--blue)', 'var(--amber)', 'var(--red)'];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.04em',
        padding: '2px 8px',
        borderRadius: 999,
        background: colors[tier] || 'var(--ink-45)',
        color: 'var(--white)',
      }}
    >
      TIER {tier}
    </span>
  );
}
