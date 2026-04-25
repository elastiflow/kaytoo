import { describe, expect, it } from 'vitest';
import { computeEgressVsBaselineRows } from '../src/opensearch/egressBaseline.js';

describe('computeEgressVsBaselineRows', () => {
  it('scales expected bytes and marks insight threshold', () => {
    const rows = computeEgressVsBaselineRows({
      current: [
        { srcIp: '10.0.0.1', bytes: 200 },
        { srcIp: '10.0.0.2', bytes: 50 },
      ],
      baseline: [{ srcIp: '10.0.0.1', bytes: 100 }],
      currentMinutes: 15,
      baselineMinutes: 60,
      egressMultiplier: 2,
      egressMinBytes: 80,
    });
    const r1 = rows.find((r) => r.srcIp === '10.0.0.1');
    expect(r1?.baselineBytes).toBe(100);
    expect(r1?.expectedBytes).toBe(25);
    expect(r1?.insightThresholdBytes).toBe(80);
    expect(r1?.passesInsightThreshold).toBe(true);
    expect(r1?.ratioVsExpected).toBeCloseTo(8);
    const r2 = rows.find((r) => r.srcIp === '10.0.0.2');
    expect(r2?.ratioVsExpected).toBeNull();
  });
});
