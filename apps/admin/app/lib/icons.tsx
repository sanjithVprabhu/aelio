import React from 'react';

type P = { size?: number };
const s = (n = 15) => ({
  width: n,
  height: n,
  fill: 'none' as const,
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const I = {
  grid: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  chat: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  ),
  users: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  log: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <line x1="21" y1="6" x2="3" y2="6" />
      <line x1="21" y1="10" x2="3" y2="10" />
      <line x1="21" y1="14" x2="3" y2="14" />
      <line x1="21" y1="18" x2="3" y2="18" />
    </svg>
  ),
  flow: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  ),
  face: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  ),
  cycle: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  zap: ({ size }: P = {}) => (
    <svg {...s(size || 13)} strokeWidth={2}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  brain: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  plug: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <line x1="9" y1="2" x2="9" y2="7" />
      <line x1="15" y1="2" x2="15" y2="7" />
      <rect x="5" y="7" width="14" height="7" rx="2" />
      <line x1="12" y1="14" x2="12" y2="22" />
    </svg>
  ),
  key: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  ),
  code: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  terminal: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  gear: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  chevD: ({ size }: P = {}) => (
    <svg {...s(size || 11)} strokeWidth={2.5}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  chevR: ({ size }: P = {}) => (
    <svg {...s(size || 10)} strokeWidth={2.5}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  menu: ({ size }: P = {}) => (
    <svg {...s(size || 16)} strokeWidth={1.9}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  plus: ({ size }: P = {}) => (
    <svg {...s(size || 11)} strokeWidth={2.5}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  trash: ({ size }: P = {}) => (
    <svg {...s(size || 13)}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  ),
  arrow: ({ size }: P = {}) => (
    <svg {...s(size || 13)} strokeWidth={2}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  search: ({ size }: P = {}) => (
    <svg {...s(size || 14)}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  bell: ({ size }: P = {}) => (
    <svg {...s(size)}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  play: ({ size }: P = {}) => (
    <svg {...s(size || 12)} strokeWidth={2}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  ),
  upload: ({ size }: P = {}) => (
    <svg {...s(size || 13)}>
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  ),
  check: ({ size }: P = {}) => (
    <svg {...s(size || 13)} strokeWidth={2.2}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
  warning: ({ size }: P = {}) => (
    <svg {...s(size || 13)}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  diff: ({ size }: P = {}) => (
    <svg {...s(size || 13)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  x: ({ size }: P = {}) => (
    <svg {...s(size || 12)} strokeWidth={2.5}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

export type IconKey = keyof typeof I;
