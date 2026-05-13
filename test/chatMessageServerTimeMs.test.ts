import { describe, expect, it } from 'vitest';
import { chatMessageServerTimeMs } from '../src/util/chatMessageServerTimeMs.js';

describe('chatMessageServerTimeMs', () => {
  it('parses Slack message.ts', () => {
    expect(chatMessageServerTimeMs('1733263434.002345')).toBeCloseTo(1733263434002.345, 3);
  });

  it('parses ISO', () => {
    expect(chatMessageServerTimeMs('2024-06-01T12:00:00.000Z')).toBe(Date.parse('2024-06-01T12:00:00.000Z'));
  });

  it('returns null when unparseable', () => {
    expect(chatMessageServerTimeMs('')).toBeNull();
    expect(chatMessageServerTimeMs('   ')).toBeNull();
    expect(chatMessageServerTimeMs('not-a-timestamp')).toBeNull();
  });
});
