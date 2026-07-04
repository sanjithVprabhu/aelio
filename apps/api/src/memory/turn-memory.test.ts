import { describe, it, expect } from 'vitest';
import { ChannelType } from '@aelio/types';
import type { Turn } from '@aelio/types';
import { mergeHistoryTurns } from './turn-memory.js';

describe('mergeHistoryTurns', () => {
  const base = (id: string, text: string, at: number): Turn => ({
    id,
    conversationId: 'conv1',
    tenantId: 't1',
    role: 'user',
    content: { type: 'text', text },
    channelType: ChannelType.WebChat,
    createdAt: new Date(at),
  });

  it('dedupes and sorts by time', () => {
    const merged = mergeHistoryTurns({
      tenantId: 't1',
      recentTurns: [base('a', 'recent', 200)],
      memoryHits: [
        {
          turnId: 'b',
          conversationId: 'conv0',
          role: 'user',
          contentText: 'older memory',
          createdAt: new Date(100),
          score: 0.9,
        },
        {
          turnId: 'a',
          conversationId: 'conv1',
          role: 'user',
          contentText: 'recent dup',
          createdAt: new Date(200),
          score: 0.8,
        },
      ],
    });
    expect(merged.map((t) => t.id)).toEqual(['b', 'a']);
    expect(merged[0]!.content).toEqual({ type: 'text', text: 'older memory' });
  });

  it('sorts when postgres returns createdAt as ISO strings', () => {
    const older = new Date('2026-07-01T10:00:00.000Z');
    const recent = new Date('2026-07-01T11:00:00.000Z');
    const merged = mergeHistoryTurns({
      tenantId: 't1',
      recentTurns: [{ ...base('a', 'recent', recent.getTime()), createdAt: recent }],
      memoryHits: [
        {
          turnId: 'b',
          conversationId: 'conv0',
          role: 'user',
          contentText: 'older memory',
          createdAt: '2026-07-01T10:00:00.000Z' as unknown as Date,
          score: 0.9,
        },
      ],
    });
    expect(merged.map((t) => t.id)).toEqual(['b', 'a']);
    expect(older.getTime()).toBeLessThan(recent.getTime());
  });
});