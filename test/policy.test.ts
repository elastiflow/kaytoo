import { describe, expect, it } from 'vitest';
import { assertIndexAllowed, clampBucketSize, clampHits, defaultAgentPolicy } from '../src/agent/policy.js';

describe('agent policy', () => {
  it('allows default elastiflow patterns', () => {
    expect(() => assertIndexAllowed('elastiflow-flow-codex-*', defaultAgentPolicy)).not.toThrow();
    expect(() => assertIndexAllowed('elastiflow-flow-codex-2026.01.01', defaultAgentPolicy)).not.toThrow();
  });

  it('rejects disallowed indices', () => {
    expect(() => assertIndexAllowed('.opensearch-security', defaultAgentPolicy)).toThrow();
  });

  it('clamps sizes', () => {
    expect(clampBucketSize(10_000, defaultAgentPolicy)).toBeLessThanOrEqual(defaultAgentPolicy.maxBucketSize);
    expect(clampHits(10_000, defaultAgentPolicy)).toBeLessThanOrEqual(defaultAgentPolicy.maxHits);
  });

  it('allows wildcard suffix patterns', () => {
    const policy = {
      ...defaultAgentPolicy,
      allowedIndexPatterns: ['logs-*'],
    };
    expect(() => assertIndexAllowed('logs-2026.01.01', policy)).not.toThrow();
  });

  it('clamps non-finite sizes to a small default', () => {
    expect(clampBucketSize(Number.NaN, defaultAgentPolicy)).toBe(10);
    expect(clampHits(Number.POSITIVE_INFINITY, defaultAgentPolicy)).toBe(10);
  });
});

