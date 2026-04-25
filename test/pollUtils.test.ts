import { describe, expect, it } from 'vitest';
import type { Finding } from '../src/detectors/types.js';
import { findingSeverityRank, shouldSkipHeuristicPoll } from '../src/insights/pollUtils.js';

describe('shouldSkipHeuristicPoll', () => {
  const r = (healthyEmpty: boolean) =>
    ({ ok: true as const, findings: [] as Finding[], healthyEmpty }) as {
      ok: boolean;
      findings: Finding[];
      healthyEmpty?: boolean;
    };

  it('is true only when both backends report healthy empty', () => {
    expect(shouldSkipHeuristicPoll(r(true), r(true))).toBe(true);
    expect(shouldSkipHeuristicPoll(r(true), r(false))).toBe(false);
    expect(shouldSkipHeuristicPoll(r(false), r(true))).toBe(false);
    expect(shouldSkipHeuristicPoll(r(false), r(false))).toBe(false);
  });

  it('returns false when alerting is not healthy empty', () => {
    expect(
      shouldSkipHeuristicPoll(
        { ok: false, findings: [], warning: 'x' },
        { ok: true, findings: [], healthyEmpty: true },
      ),
    ).toBe(false);
  });

  it('returns false when AD is not healthy empty', () => {
    expect(
      shouldSkipHeuristicPoll(
        { ok: true, findings: [], healthyEmpty: true },
        { ok: false, findings: [], warning: 'x' },
      ),
    ).toBe(false);
  });

  it('returns false when healthyEmpty flags are absent', () => {
    expect(
      shouldSkipHeuristicPoll(
        { ok: true, findings: [] },
        { ok: true, findings: [] },
      ),
    ).toBe(false);
  });
});

describe('findingSeverityRank', () => {
  it('orders severities from high to info', () => {
    expect(findingSeverityRank('high')).toBe(4);
    expect(findingSeverityRank('medium')).toBe(3);
    expect(findingSeverityRank('low')).toBe(2);
    expect(findingSeverityRank('info')).toBe(1);
  });
});
