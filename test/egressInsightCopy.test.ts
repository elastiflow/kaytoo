import { describe, expect, it } from 'vitest';
import { buildEgressComparisonFrame, buildEgressVolumeSummary } from '../src/insights/egressInsightCopy.js';

describe('egressInsightCopy', () => {
  it('buildEgressComparisonFrame labels primary vs spike', () => {
    expect(buildEgressComparisonFrame('primary', 60, 1440)).toMatch(/^Primary:/);
    expect(buildEgressComparisonFrame('spike', 15, 1440)).toMatch(/^Spike:/);
  });

  it('buildEgressVolumeSummary handles zero baseline', () => {
    expect(buildEgressVolumeSummary(1e6, 0, Infinity)).toMatch(/no baseline/i);
  });

  it('buildEgressVolumeSummary includes ratio when expected positive', () => {
    expect(buildEgressVolumeSummary(100, 50, 2)).toContain('2.0x');
  });

  it('buildEgressVolumeSummary non-finite ratio', () => {
    expect(buildEgressVolumeSummary(100, 50, Number.POSITIVE_INFINITY)).toContain('(highx)');
    expect(buildEgressVolumeSummary(100, 50, Number.NaN)).toContain('(n/ax)');
  });
});
