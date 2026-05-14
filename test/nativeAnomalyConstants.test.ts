import { describe, expect, it } from 'vitest';
import { detectionIntervalMinutes } from '../src/insights/nativeAnomalyConstants.js';

describe('detectionIntervalMinutes', () => {
  it('clamps to minimum 5 and maximum 60', () => {
    expect(detectionIntervalMinutes(30)).toBe(5);
    expect(detectionIntervalMinutes(120)).toBe(5);
    expect(detectionIntervalMinutes(600)).toBe(10);
    expect(detectionIntervalMinutes(3600)).toBe(60);
  });
});
