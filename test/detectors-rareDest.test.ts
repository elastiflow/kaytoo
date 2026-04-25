import { describe, expect, it } from 'vitest';
import { detectRareDestinations } from '../src/detectors/rareDest.js';

describe('detectRareDestinations', () => {
  it('creates findings and assigns severity based on score', () => {
    const findings = detectRareDestinations({
      window: { from: 'a', to: 'b' },
      rows: [
        { dstIp: '1.1.1.1', score: 9.5, docCount: 2, bytes: 1234 },
        { dstIp: '2.2.2.2', score: 10, docCount: 3, bytes: 99 },
      ],
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]?.severity).toBe('low');
    expect(findings[1]?.severity).toBe('medium');
    expect(findings[0]?.id).toBe('raredest:1.1.1.1');
    expect(findings[1]?.id).toBe('raredest:2.2.2.2');
  });
});

