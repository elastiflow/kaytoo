import { describe, expect, it } from 'vitest';
import { formatBytesHuman, formatEndpointLabel } from '../src/util/formatInsight.js';

describe('formatInsight', () => {
  it('formatEndpointLabel uses display name with ip when present', () => {
    expect(formatEndpointLabel({ displayName: 'pod-a', ip: '10.0.0.1' })).toBe('pod-a (10.0.0.1)');
    expect(formatEndpointLabel({ displayName: '  ', ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(formatEndpointLabel({ ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('formatBytesHuman formats common sizes', () => {
    expect(formatBytesHuman(512)).toMatch(/512 B/);
    expect(formatBytesHuman(2048)).toContain('KB');
    expect(formatBytesHuman(5 * 1024 * 1024)).toContain('MB');
  });
});
