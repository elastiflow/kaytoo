import { describe, expect, it, vi } from 'vitest';
import type { Finding } from '../src/detectors/types.js';
import {
  findingSeverityRank,
  selectNovelInsightPostBatch,
  shouldSkipHeuristicPoll,
} from '../src/insights/pollUtils.js';

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

describe('selectNovelInsightPostBatch', () => {
  it('keeps only novel medium/high findings capped at three', () => {
    const dedupe = { has: vi.fn((id: string) => id === 'seen') };
    const findings: Finding[] = [
      { id: 'a', kind: 'port_scan', severity: 'high', title: 't', summary: 's', evidence: {}, window: { from: 'a', to: 'b' } },
      { id: 'b', kind: 'port_scan', severity: 'medium', title: 't', summary: 's', evidence: {}, window: { from: 'a', to: 'b' } },
      { id: 'seen', kind: 'port_scan', severity: 'high', title: 't', summary: 's', evidence: {}, window: { from: 'a', to: 'b' } },
      { id: 'c', kind: 'port_scan', severity: 'low', title: 't', summary: 's', evidence: {}, window: { from: 'a', to: 'b' } },
      { id: 'd', kind: 'port_scan', severity: 'medium', title: 't', summary: 's', evidence: {}, window: { from: 'a', to: 'b' } },
      { id: 'e', kind: 'port_scan', severity: 'medium', title: 't', summary: 's', evidence: {}, window: { from: 'a', to: 'b' } },
    ];
    const batch = selectNovelInsightPostBatch(findings, dedupe);
    expect(batch.map((f) => f.id)).toEqual(['a', 'b', 'd']);
  });

  it('egress primary and spike stay separate batch entries for one host', () => {
    const dedupe = { has: () => false };
    const key = 'v6-64:2001:0db8:0000:0000';
    const findings: Finding[] = [
      {
        id: `egress:${key}`,
        kind: 'egress_anomaly',
        severity: 'medium',
        title: 't1',
        summary: 's',
        evidence: {},
        window: { from: 'a', to: 'b' },
      },
      {
        id: `egress_spike:${key}`,
        kind: 'egress_anomaly',
        severity: 'medium',
        title: 't2',
        summary: 's',
        evidence: {},
        window: { from: 'a', to: 'b' },
      },
    ];
    expect(selectNovelInsightPostBatch(findings, dedupe)).toHaveLength(2);
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
